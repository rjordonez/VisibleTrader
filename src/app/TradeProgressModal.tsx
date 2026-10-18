import { useEffect, useMemo, useRef, useState } from 'react'
import { Download, LoaderCircle, RotateCcw } from 'lucide-react'
import { fitFont, FONT, GREEN, RED, roundRect } from './shareCanvas'
import './trade-progress.css'
import { replayPnl, replayValue, replayBounds } from './tradeProgressMath'

export type PositionExportData = {
  title: string; outcome: string; conditionId: string; closedAt?: string; historyUnavailable?: boolean; status?: 'Won' | 'Lost' | 'Closed'
  invested: number; size?: number; avgPrice: number; curPrice: number; pnl: number; image?: string | null
}
type Point = { d: string; cum: number }
const WIDTH = 1080, HEIGHT = 1180, SECONDS = 6
const money = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
const dollars = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
const sharePrice = (n: number) => `$${n.toFixed(3)}`

// The chart and dollar metrics share a single replay cursor. P&L is modeled
// at today's position size, anchored to the actual current P&L at the end.
function drawProgress(canvas: HTMLCanvasElement, name: string, points: Point[], progress: number, trade: PositionExportData, logo: HTMLImageElement | null, marketLogo: HTMLImageElement | null, snapshotTime: string) {
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  if (canvas.width !== WIDTH) canvas.width = WIDTH
  if (canvas.height !== HEIGHT) canvas.height = HEIGHT
  let price = points[0]?.cum ?? trade.curPrice
  let index = 0
  const times = points.map(p => Date.parse(p.d))
  const first = times[0] ?? 0, last = times[times.length - 1] ?? first
  const current = first + (last - first) * progress
  while (index + 1 < points.length && times[index + 1] <= current) index++
  price = points[index]?.cum ?? price
  const pnl = replayPnl(trade, price)
  const positionValue = replayValue(trade, price)
  const accent = pnl >= 0 ? GREEN : RED
  ctx.fillStyle = '#5662ff'; ctx.fillRect(0, 0, WIDTH, HEIGHT)
  roundRect(ctx, 12, 12, WIDTH - 24, HEIGHT - 24, 64); ctx.fillStyle = '#030312'; ctx.fill()
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left'
  ctx.save(); ctx.beginPath(); ctx.arc(118, 118, 70, 0, Math.PI * 2); ctx.clip()
  ctx.fillStyle = '#25ed84'; ctx.fillRect(48, 48, 140, 140)
  if (logo) ctx.drawImage(logo, 48, 48, 140, 140)
  else { ctx.fillStyle = '#fff'; ctx.font = `800 66px ${FONT}`; ctx.fillText(name[0]?.toUpperCase() ?? 'V', 94, 142) }
  ctx.restore()
  ctx.fillStyle = '#fff'; fitFont(ctx, name, 700, 54, 520); ctx.fillText(name, 222, 102)
  roundRect(ctx, 222, 132, 114, 48, 7); ctx.fillStyle = '#1c1a48'; ctx.fill()
  ctx.fillStyle = trade.status === 'Lost' ? RED : trade.status === 'Won' ? GREEN : '#8790ff'; ctx.font = `700 30px ${FONT}`; ctx.fillText(trade.status ?? 'Open', 234, 166)
  ctx.textAlign = 'right'; ctx.fillStyle = '#626275'; ctx.font = `500 29px ${FONT}`
  ctx.fillText(new Date(trade.closedAt ?? snapshotTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), 1020, 95)
  const gx = 40, gy = 320, gw = 780, gh = 280
  if (points.length >= 2 && !trade.historyUnavailable) {
    const values = points.map(p => replayValue(trade, p.cum))
    const target = replayBounds(values.slice(0, index + 1))
    const previous = replayBounds(values.slice(0, Math.max(1, index)))
    const transition = Math.max(1, (last - first) * .045)
    const elapsed = Math.max(0, current - times[index])
    const blend = progress >= 1 ? 1 : 1 - Math.exp(-elapsed / (transition / 4))
    const min = previous.min + (target.min - previous.min) * blend
    const max = previous.max + (target.max - previous.max) * blend
    const span = max - min
    const x = (t: number) => gx + (last > first ? (t - first) / (last - first) : 0) * gw
    const valueY = (v: number) => gy + gh - (v - min) / span * gh
    const y = (v: number) => valueY(replayValue(trade, v))
    ctx.strokeStyle = '#29504a'; ctx.lineWidth = 2; ctx.setLineDash([8, 10])
    ctx.beginPath(); ctx.moveTo(gx, y(price)); ctx.lineTo(830, y(price)); ctx.stroke(); ctx.setLineDash([])
    ctx.save(); ctx.beginPath(); ctx.rect(gx - 8, gy - 12, gw + 16, gh + 24); ctx.clip()
    ctx.beginPath(); ctx.moveTo(gx, y(points[0].cum))
    for (let i = 1; i <= index; i++) ctx.lineTo(x(times[i]), y(points[i].cum))
    ctx.lineTo(x(current), y(price)); ctx.strokeStyle = accent; ctx.lineWidth = 7; ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.stroke(); ctx.restore()
    const badgeY = Math.min(620, Math.max(292, y(price) - 25))
    ctx.textAlign = 'right'; ctx.fillStyle = '#6e6e81'; ctx.font = `500 29px ${FONT}`
    // Round milestones appear only after being reached. Scale movement,
    // edge fades and collision fades keep the axis quiet as the range grows.
    const highSeen = Math.max(...values.slice(0, index + 1))
    const milestones: number[] = []
    for (let power = -2; power <= Math.ceil(Math.log10(Math.max(1, highSeen))); power++) {
      for (const multiple of [1, 2, 5]) {
        const tick = multiple * 10 ** power
        if (tick <= highSeen && tick >= min - span * .1 && tick <= max + span * .1) milestones.push(tick)
      }
    }
    const labelRows = [badgeY + 25]
    const clamp = (n: number) => Math.max(0, Math.min(1, n))
    for (const tick of milestones.reverse()) {
      const tickY = valueY(tick)
      const edgeFade = clamp((tickY - gy + 10) / 28) * clamp((gy + gh + 10 - tickY) / 28)
      const spacingFade = clamp((Math.min(...labelRows.map(row => Math.abs(row - tickY))) - 24) / 28)
      const crossedAt = values.findIndex(v => v >= tick)
      const arrivalFade = crossedAt <= 0 ? 1 : clamp((current - times[crossedAt]) / transition)
      const alpha = edgeFade * spacingFade * arrivalFade
      if (alpha < .02) continue
      ctx.save(); ctx.globalAlpha = alpha
      const label = tick >= 1000 ? `$${Number((tick / 1000).toFixed(1))}k` : dollars(tick)
      ctx.fillText(label, 1028, tickY + 10); ctx.restore()
      if (alpha > .5) labelRows.push(tickY)
    }
    ctx.textAlign = 'right'; ctx.fillStyle = accent; fitFont(ctx, dollars(positionValue), 700, 34, 192); ctx.fillText(dollars(positionValue), 1028, badgeY + 36)
    ctx.textAlign = 'center'; ctx.fillStyle = '#6e6e81'; ctx.font = `500 25px ${FONT}`
    const timeLabel = (t: number) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
    for (let i = 1; i <= 3; i++) ctx.fillText(timeLabel(first + (last - first) * i / 4), gx + gw * i / 4, 686)
  }
  if (trade.historyUnavailable) {
    ctx.textAlign = 'center'; ctx.fillStyle = '#aaaabb'; ctx.font = `600 36px ${FONT}`
    ctx.fillText('Final position result', 540, 445)
    ctx.fillStyle = '#6e6e81'; ctx.font = `500 26px ${FONT}`
    ctx.fillText('Market price history unavailable', 540, 498)
  }
  ctx.textAlign = 'center'; ctx.fillStyle = '#6e6e81'; ctx.font = `500 22px ${FONT}`
  ctx.fillText(`Entry price ${sharePrice(trade.avgPrice)} · Share price ${sharePrice(price)}`, 540, 724)
  ctx.fillStyle = '#10101f'; roundRect(ctx, 36, 752, 1008, 392, 36); ctx.fill()
  ctx.strokeStyle = '#2b2b40'; ctx.lineWidth = 2; ctx.stroke()
  ctx.fillStyle = '#fff'; fitFont(ctx, trade.title, 600, 40, 830)
  const titleWidth = ctx.measureText(trade.title).width
  const iconSpace = marketLogo ? 72 : 0
  const titleX = (WIDTH - titleWidth - iconSpace) / 2
  ctx.save(); ctx.beginPath(); ctx.arc(titleX + 26, 810, 26, 0, Math.PI * 2); ctx.clip()
  if (marketLogo) ctx.drawImage(marketLogo, titleX, 784, 52, 52)
  ctx.restore(); ctx.textAlign = 'left'; ctx.fillText(trade.title, titleX + iconSpace, 824)
  ctx.textAlign = 'center'
  ctx.fillStyle = '#85859b'; ctx.font = `500 25px ${FONT}`; ctx.fillText(trade.outcome, 540, 866)
  const roi = trade.invested > 0 ? pnl / trade.invested * 100 : null
  const profit = Math.abs(pnl) < .005 ? '$0' : money(pnl)
  const roiText = roi == null ? '(▲ —)' : `(${roi >= 0 ? '▲' : '▼'} ${Math.abs(roi).toFixed(2)}%)`
  fitFont(ctx, profit, 700, 84, 610)
  const profitFont = ctx.font, profitWidth = ctx.measureText(profit).width
  ctx.font = `500 34px ${FONT}`; const roiWidth = ctx.measureText(roiText).width
  const left = (WIDTH - profitWidth - 28 - roiWidth) / 2
  ctx.textAlign = 'left'; ctx.font = profitFont; ctx.fillStyle = accent; ctx.fillText(profit, left, 956)
  ctx.font = `500 34px ${FONT}`; ctx.fillStyle = accent; ctx.fillText(roiText, left + profitWidth + 28, 945)
  ctx.fillStyle = '#262637'; ctx.fillRect(36, 1000, 1008, 2)
  const stats = [['Invested', dollars(trade.invested)], ['Avg. entry', `${(trade.avgPrice * 100).toFixed(1)}¢`], [trade.closedAt ? 'Exit value' : 'Current value', dollars(positionValue)]]
  stats.forEach(([label, value], i) => {
    const mid = 36 + 336 * i + 168
    if (i) { ctx.fillStyle = '#262637'; ctx.fillRect(36 + 336 * i, 1002, 2, 142) }
    ctx.textAlign = 'center'; ctx.fillStyle = '#b0b0c2'; ctx.font = `500 32px ${FONT}`; ctx.fillText(label, mid, 1058)
    ctx.fillStyle = '#fff'; fitFont(ctx, value, 500, 42, 286); ctx.fillText(value, mid, 1114)
  })
}

export function TradeProgressModal({ name, wallet, points, trade, loading = false, loadError = false, onRetry, onClose }: { name: string; wallet: string; points: Point[]; trade: PositionExportData; loading?: boolean; loadError?: boolean; onRetry?: () => void; onClose: () => void }) {
  const [snapshotTime] = useState(() => new Date().toISOString())
  const [marketLogo, setMarketLogo] = useState<HTMLImageElement | null>(null)
  const [logo, setLogo] = useState<HTMLImageElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  const [progress, setProgress] = useState(0)
  const [replayId, setReplayId] = useState(0)
  const [ended, setEnded] = useState(false)
  const [recording, setRecording] = useState(false)
  const [error, setError] = useState('')
  const [download, setDownload] = useState<{ url: string; ext: string } | null>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const cleanPoints = useMemo(() => {
    const valid = points.filter(p => Number.isFinite(p.cum) && p.cum >= 0 && p.cum <= 1 && Number.isFinite(Date.parse(p.d))).sort((a, b) => Date.parse(a.d) - Date.parse(b.d))
    if (valid.length && Number.isFinite(trade.curPrice) && valid[valid.length - 1].cum !== trade.curPrice) {
      valid.push({ d: new Date(Math.max(Date.parse(trade.closedAt ?? snapshotTime), Date.parse(valid[valid.length - 1].d) + 1)).toISOString(), cum: trade.curPrice })
    }
    return valid
  }, [points, trade.curPrice, trade.closedAt, snapshotTime])
  const mime = typeof MediaRecorder === 'undefined' ? '' : ['video/mp4;codecs=avc1.42001E', 'video/mp4;codecs=avc1.42E01E', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find(t => MediaRecorder.isTypeSupported(t)) ?? ''

  useEffect(() => {
    const dialog = dialogRef.current
    const previous = document.activeElement as HTMLElement | null
    dialog?.showModal()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { cancelRef.current?.(); dialog?.close(); document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  useEffect(() => {
    let cancelled = false
    const image = new Image(); image.crossOrigin = 'anonymous'
    image.onload = () => { if (!cancelled) setLogo(image) }
    image.onerror = () => { if (!cancelled && image.src !== new URL('/trade-progress-avatar.svg', location.origin).href) image.src = '/trade-progress-avatar.svg' }
    image.src = '/trade-progress-avatar.svg'
    return () => { cancelled = true }
  }, [])
  useEffect(() => {
    if (!trade.image) return
    let cancelled = false
    const image = new Image(); image.crossOrigin = 'anonymous'
    image.onload = () => { if (!cancelled) setMarketLogo(image) }
    image.src = trade.image
    return () => { cancelled = true }
  }, [trade.image])
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url) }, [download])
  useEffect(() => { if (canvasRef.current) drawProgress(canvasRef.current, name, cleanPoints, progress, trade, logo, marketLogo, snapshotTime) }, [name, cleanPoints, progress, trade, logo, marketLogo, snapshotTime])
  useEffect(() => {
    if (recording || loading || cleanPoints.length < 2 || ended) return
    let frame = 0, start: number | null = null
    const tick = (now: number) => {
      start ??= now
      const p = Math.min(1, (now - start) / (SECONDS * 1000))
      setProgress(p)
      if (p < 1) frame = requestAnimationFrame(tick)
      else setEnded(true)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [recording, loading, cleanPoints.length, replayId, ended])

  const exportVideo = () => {
    const canvas = canvasRef.current
    if (!canvas || !mime || cleanPoints.length < 2) return
    setError(''); setEnded(false); setRecording(true); setProgress(0); setDownload(null)
    let stream: MediaStream | null = null
    try {
      stream = canvas.captureStream(30)
      const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 })
      const chunks: Blob[] = []
      let frame = 0, cancelled = false
      const stopTracks = () => stream?.getTracks().forEach(t => t.stop())
      cancelRef.current = () => { cancelled = true; cancelAnimationFrame(frame); if (recorder.state !== 'inactive') recorder.stop(); stopTracks() }
      recorder.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
      recorder.onerror = () => { cancelRef.current?.(); setError('Video export failed. Please try again.'); setRecording(false) }
      recorder.onstop = () => {
        stopTracks(); cancelRef.current = null
        if (cancelled) return
        const blob = new Blob(chunks, { type: recorder.mimeType })
        if (!blob.size) setError('The video was empty. Please try again with this tab visible.')
        else {
          const file = { url: URL.createObjectURL(blob), ext: recorder.mimeType.includes('mp4') ? 'mp4' : 'webm' }
          setDownload(file)
          const link = document.createElement('a'); link.href = file.url
          link.download = `${wallet}-trade-progress.${file.ext}`; link.click()
        }
        setEnded(true); setRecording(false)
      }
      drawProgress(canvas, name, cleanPoints, 0, trade, logo, marketLogo, snapshotTime)
      recorder.start()
      let start: number | null = null
      const tick = (now: number) => {
        start ??= now
        const elapsed = (now - start) / 1000
        const p = Math.min(1, elapsed / (SECONDS - .75))
        drawProgress(canvas, name, cleanPoints, p, trade, logo, marketLogo, snapshotTime); setProgress(p)
        if (elapsed < SECONDS) frame = requestAnimationFrame(tick)
        else recorder.stop()
      }
      frame = requestAnimationFrame(tick)
    } catch {
      stream?.getTracks().forEach(t => t.stop()); setRecording(false)
      setError('Could not start video export. Try a current Chrome or Safari browser.')
    }
  }

  const unavailable = recording || loading || loadError || !logo || !mime || cleanPoints.length < 2
  const downloadTitle = recording ? 'Creating video…' : 'Download video (price replay at current position size)'
  return <dialog ref={dialogRef} className="trade-progress-dialog" aria-label={`${name} — ${trade.title} trade replay`}
    onClick={e => { if (e.target === e.currentTarget) onClose() }} onCancel={e => { e.preventDefault(); onClose() }}>
    <div className="trade-progress-card">
      {ended && !recording && <button type="button" className="trade-progress-replay" aria-label="Replay video" title="Replay" onClick={() => { setProgress(0); setEnded(false); setReplayId(id => id + 1) }}><RotateCcw size={18} /></button>}
      <canvas ref={canvasRef} className="trade-progress-preview" role="img" aria-label={`${name} position in ${trade.title}`} />
      {download && !recording ? <a className="trade-progress-download" href={download.url} download={`${wallet}-trade-progress.${download.ext}`} aria-label="Download video" title={downloadTitle}><Download size={24} /></a>
        : <button type="button" className="trade-progress-download" disabled={unavailable} onClick={exportVideo} aria-label={recording ? 'Creating video' : 'Download video'} title={downloadTitle}>
          {recording ? <LoaderCircle size={24} className="trade-progress-spinner" /> : <Download size={24} />}
        </button>}
    </div>
    <p className="trade-progress-sr-only">Price replay at a fixed position size. Past buys and sells are not reconstructed. Keep this tab visible during download. Press Escape to close.</p>
    {loading && <p role="status">Loading market history…</p>}
    {recording && <p role="status" className="trade-progress-sr-only">Creating video…</p>}
    {loadError && <p role="alert">Could not load market history. <button type="button" onClick={onRetry}>Retry</button></p>}
    {!loading && !loadError && cleanPoints.length < 2 && <p role="alert">Not enough market history to export yet.</p>}
    {!mime && <p role="alert">Video export is unavailable in this browser. Try current Chrome or Safari.</p>}
    {error && <p role="alert">{error}</p>}
  </dialog>
}
