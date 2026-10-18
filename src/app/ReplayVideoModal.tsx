import { useEffect, useRef, useState } from 'react'
import { Download, LoaderCircle, RotateCcw } from 'lucide-react'
import './trade-progress.css'

const REPLAY_DURATION_MS = 8000
const FINAL_HOLD_MS = 750

export function ReplayVideoModal({ label, fileName, draw, ready, description, onClose }: {
  label: string; fileName: string; draw: (canvas: HTMLCanvasElement, progress: number) => void
  ready: boolean; description: string; onClose: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null), dialogRef = useRef<HTMLDialogElement>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  const [progress, setProgress] = useState(0), [run, setRun] = useState(0)
  const [ended, setEnded] = useState(false), [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const [file, setFile] = useState<{url: string; ext: string} | null>(null)
  const mime = typeof MediaRecorder === 'undefined' ? '' : ['video/mp4;codecs=avc1.42001E','video/mp4;codecs=avc1.42E01E','video/webm;codecs=vp9','video/webm'].find(m => MediaRecorder.isTypeSupported(m)) ?? ''
  useEffect(() => {
    const dialog = dialogRef.current, previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    dialog?.showModal(); document.body.style.overflow = 'hidden'
    return () => { cancelRef.current?.(); dialog?.close(); document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  useEffect(() => () => { if (file) URL.revokeObjectURL(file.url) }, [file])
  useEffect(() => { if (canvasRef.current) draw(canvasRef.current, progress) }, [draw, progress])
  useEffect(() => {
    if (!ready || ended || recording) return
    let frame = 0, start: number | null = null
    const tick = (now: number) => {
      start ??= now
      const p = Math.min(1,(now - start)/REPLAY_DURATION_MS); setProgress(p)
      if (p < 1) frame = requestAnimationFrame(tick); else setEnded(true)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [ready, ended, recording, run])
  const save = () => {
    const canvas = canvasRef.current
    if (!canvas || !mime || !ready) return
    setRecording(true); setEnded(false); setProgress(0); setFile(null); setError('')
    let stream: MediaStream | null = null
    try {
      stream = canvas.captureStream(30)
      const recorder = new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:8_000_000})
      const chunks: Blob[] = []; let frame = 0, cancelled = false
      const stop = () => stream?.getTracks().forEach(t => t.stop())
      cancelRef.current = () => { cancelled = true; cancelAnimationFrame(frame); if (recorder.state !== 'inactive') recorder.stop(); stop() }
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      recorder.onerror = () => { cancelRef.current?.(); setRecording(false); setError('Export failed. Please try again.') }
      recorder.onstop = () => {
        stop(); cancelRef.current = null
        if (cancelled) return
        const blob = new Blob(chunks,{type:recorder.mimeType})
        if (blob.size) {
          const result = {url:URL.createObjectURL(blob),ext:recorder.mimeType.includes('mp4')?'mp4':'webm'}
          setFile(result)
          const a = document.createElement('a'); a.href = result.url; a.download = `${fileName}.${result.ext}`; a.click()
        } else setError('The video was empty. Keep this tab visible and try again.')
        setEnded(true); setRecording(false)
      }
      draw(canvas,0); recorder.start()
      let start: number | null = null
      const tick = (now: number) => {
        start ??= now
        const elapsed = now - start, p = Math.min(1,elapsed/(REPLAY_DURATION_MS - FINAL_HOLD_MS))
        draw(canvas,p); setProgress(p)
        if (elapsed < REPLAY_DURATION_MS) frame = requestAnimationFrame(tick); else recorder.stop()
      }
      frame = requestAnimationFrame(tick)
    } catch {
      stream?.getTracks().forEach(t => t.stop()); setRecording(false); setError('Could not start video export. Try current Chrome or Safari.')
    }
  }
  return <dialog ref={dialogRef} className="trade-progress-dialog" aria-label={label} onClick={e => {if(e.target===e.currentTarget) onClose()}} onCancel={e => {e.preventDefault();onClose()}}>
    <div className="trade-progress-card">
      <canvas ref={canvasRef} className="trade-progress-preview" role="img" aria-label={label}/>
      {ended && !recording && <button type="button" className="trade-progress-replay" aria-label="Replay video" title="Replay" onClick={() => {setProgress(0);setEnded(false);setRun(r=>r+1)}}><RotateCcw size={18}/></button>}
      {file && !recording ? <a className="trade-progress-download" href={file.url} download={`${fileName}.${file.ext}`} aria-label="Download video" title="Download video"><Download size={24}/></a>
        : <button type="button" className="trade-progress-download" disabled={!ready||!mime||recording} aria-label={recording?'Creating video':'Download video'} title="Download account replay" onClick={save}>{recording?<LoaderCircle className="trade-progress-spinner" size={24}/>:<Download size={24}/>}</button>}
    </div>
    <p className="trade-progress-sr-only">{description} Press Escape to close. Keep this tab visible while exporting.</p>
    {recording && <p role="status" className="trade-progress-sr-only">Creating video…</p>}
    {error && <p role="alert">{error}</p>}
    {!mime && <p role="alert">Video export is unavailable in this browser.</p>}
  </dialog>
}
