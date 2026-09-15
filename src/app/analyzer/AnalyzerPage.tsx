import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowUp, ArrowUpRight, Check, ChevronDown, FileText, Globe, ImagePlus, Link2, LoaderCircle, Plus, ScanLine, Sparkles, Square, Users, X } from 'lucide-react'
import { supabase, supabaseFunctionsUrl } from '../../lib/supabase'
import './analyzer.css'

type Report = {
  title: string; action: 'BUY'; outcome: string; price: number | null; reason: string; risk: string
  evidence: { title: string; detail: string }[]
  traders: { name: string; price: number; outcome: string; exited: boolean }[]
  image: string | null; url: string | null; asOf: string
}
type Progress = {
  stage: 'connecting' | 'market' | 'traders' | 'reasoning'
  label: string; title?: string; image?: string | null; marketVerified?: boolean
  outcomes?: { name: string; price: number | null }[]; positionCount?: number; tradersAvailable?: boolean
}
type Turn = { id: number; url: string; image: string | null; filename: string; progress: Progress; report?: Report; error?: string; example?: boolean }
const cents = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}¢`
const stages = ['connecting', 'market', 'traders', 'reasoning']

function Processing({ turn }: { turn: Turn }) {
  const { progress: p } = turn
  const step = stages.indexOf(p.stage)
  const preview = p.image || turn.image
  return <div className="ac-processing" aria-label="Analysis in progress">
    <div className="ac-processing-title" role="status"><LoaderCircle className="ac-spin" size={17} /><strong>{p.label}</strong><span>{turn.example ? 'EXAMPLE' : 'WORKING'}</span></div>
    <div className="ac-workbench">
      <div className="ac-scan-document">
        <div className="ac-document-top"><Globe size={13} /><span>{turn.url ? 'polymarket.com' : turn.example ? 'Example market' : 'Your screenshot'}</span><i /></div>
        <div className="ac-document-body">
          {preview ? <img src={preview} alt="Market being analyzed" /> : <div className="ac-document-placeholder"><FileText size={28} /><div /><div /><div /></div>}
          <div className="ac-scan-beam" />
        </div>
        <strong>{p.title || (turn.url || turn.example ? 'Locating your market…' : 'Extracting market details…')}</strong>
        <div className="ac-document-prices">{p.outcomes?.length ? p.outcomes.slice(0, 2).map(o => <span key={o.name}>{o.name}<b>{cents(o.price)}</b></span>) : <><i /><i /></>}</div>
      </div>
      <svg className="ac-connections" viewBox="0 0 120 220" preserveAspectRatio="none" fill="none" aria-hidden="true"><path d="M0 110H35Q55 110 55 75V40Q55 20 80 20H120M0 110H120M0 110H35Q55 110 55 145V180Q55 200 80 200H120" /></svg>
      <div className="ac-work-items">
        <div className={step >= 2 ? 'is-ready' : 'is-working'}><span className="ac-work-icon"><ScanLine size={19} /></span><section><strong>Market & price</strong><small>{step >= 2 ? p.marketVerified ? `${p.outcomes?.length ?? 0} outcomes retrieved` : 'Screenshot supplied · price unverified' : 'Reading market details'}</small></section>{step >= 2 && <Check size={15} />}</div>
        <div className={step >= 3 ? 'is-ready' : step >= 2 ? 'is-working' : ''}><span className="ac-work-icon"><Users size={19} /></span><section><strong>Trader activity</strong><small>{step >= 3 ? p.tradersAvailable ? `${p.positionCount ?? 0} recent positions retrieved` : 'No verified position data' : step >= 2 ? 'Looking up tracked entries' : 'Waiting for the market'}</small></section>{step >= 3 && <Check size={15} />}</div>
        <div className={step >= 3 ? 'is-working' : ''}><span className="ac-work-icon"><Sparkles size={19} /></span><section><strong>Your pick</strong><small>{step >= 3 ? 'Weighing evidence across the sides' : 'Waiting for the evidence'}</small></section>{step >= 3 && <LoaderCircle size={15} className="ac-spin" />}</div>
      </div>
    </div>
    <div className="ac-processing-footer"><span className="ac-live-dot" />{step >= 3 ? 'Turning the evidence into one clear call.' : 'Bringing the market and tracked activity together.'}</div>
  </div>
}

function Result({ report, example }: { report: Report; example?: boolean }) {
  return <div className="ac-result">
    <div className="ac-result-market">{report.image && <img src={report.image} alt="" />}<span>{report.title}</span></div>
    <div className="ac-decision"><ArrowUpRight size={25} /><h2>Buy {report.outcome}</h2>{report.price !== null && <span>{cents(report.price)}<small>quoted</small></span>}</div>
    <p className="ac-reason">{report.reason}</p>
    <div className="ac-reasons">{report.evidence.map((item, i) => <div key={i}><span>{String(i + 1).padStart(2, '0')}</span><p><strong>{item.title}</strong> {item.detail}</p></div>)}</div>
    {report.traders.length > 0 && <details className="ac-trader-details"><summary><Users size={15} />{report.traders.length} tracked traders on this side<ChevronDown size={14} /></summary><div>{report.traders.map((t, i) => <div className="ac-trader" key={i}><span>{t.name.slice(0, 2).toUpperCase()}</span><strong>{t.name}</strong><small>{t.exited ? 'Exited' : 'No recorded exit'}</small><b>{cents(t.price)}</b></div>)}</div></details>}
    <p className="ac-risk"><span>Watch for</span>{report.risk}</p>
    <footer>{example ? <span>Example · fictional data</span> : <span>{report.price === null ? 'Price unverified' : 'Price snapshot'} · {new Date(report.asOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>}{report.url && <a href={report.url} target="_blank" rel="noreferrer">Open market <ArrowUpRight size={14} /></a>}</footer>
  </div>
}

export default function AnalyzerPage() {
  const [url, setUrl] = useState('')
  const [image, setImage] = useState<string | null>(null)
  const [filename, setFilename] = useState('')
  const [turns, setTurns] = useState<Turn[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragging, setDragging] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const textInput = useRef<HTMLInputElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const controller = useRef<AbortController | null>(null)
  const sequence = useRef(0)
  const exampleTimers = useRef<ReturnType<typeof setTimeout>[]>([])
  useEffect(() => () => { controller.current?.abort(); exampleTimers.current.forEach(clearTimeout) }, [])
  useEffect(() => { if (turns.length) bottom.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'end' }) }, [turns.length])
  const update = (id: number, patch: Partial<Turn>) => setTurns(current => current.map(t => t.id === id ? { ...t, ...patch } : t))
  const readFile = (file?: File) => {
    if (!file || busy) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 4 * 1024 * 1024) { setError('Choose a PNG, JPG, or WebP under 4 MB.'); return }
    setError('')
    const reader = new FileReader()
    reader.onload = () => { setImage(String(reader.result)); setFilename(file.name) }
    reader.onerror = () => setError('This image could not be opened.')
    reader.readAsDataURL(file)
  }
  const cancel = () => {
    controller.current?.abort()
    exampleTimers.current.forEach(clearTimeout)
    if (busy) update(sequence.current, { error: 'Analysis stopped.' })
    setBusy(false)
  }
  const analyze = async (event: FormEvent) => {
    event.preventDefault()
    if (busy) return
    if (!url.trim() && !image) { setError('Paste a market link or attach a screenshot.'); return }
    if (url.trim()) {
      try { const p = new URL(url.trim()); if (p.protocol !== 'https:' || !['polymarket.com', 'www.polymarket.com'].includes(p.hostname) || !/^\/(event|market)\/[^/]+/.test(p.pathname)) throw new Error() }
      catch { setError('Use a full https://polymarket.com/event/… market link.'); return }
    }
    const id = ++sequence.current
    const turn: Turn = { id, url: url.trim(), image, filename, progress: { stage: 'connecting', label: 'Connecting to your market' } }
    const abort = new AbortController()
    controller.current = abort
    setTurns(current => [...current, turn]); setBusy(true); setError(''); setUrl(''); setImage(null); setFilename('')
    const timeout = setTimeout(() => abort.abort('timeout'), 90000)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sign in to analyze a market.')
      const response = await fetch(`${supabaseFunctionsUrl}/analyze-market`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify({ url: turn.url || null, image: turn.image }), signal: abort.signal,
      })
      if (!response.ok) { const body = await response.json().catch(() => null); throw new Error(body?.error || 'Analysis is unavailable. Please try again.') }
      if (!response.headers.get('content-type')?.includes('application/x-ndjson') || !response.body) throw new Error('Please refresh and try again. Live processing is not available yet.')
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = '', completed = false
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n'); buffer = lines.pop() || ''
          for (const line of lines) {
            if (!line.trim()) continue
            const message = JSON.parse(line)
            if (message.type === 'error') throw new Error(message.error)
            if (message.type === 'progress') setTurns(current => current.map(t => t.id === id ? { ...t, progress: { ...t.progress, ...message } } : t))
            if (message.type === 'result') {
              const result = message.report
              if (result?.action !== 'BUY' || typeof result.outcome !== 'string' || !Array.isArray(result.evidence) || !Array.isArray(result.traders)) throw new Error('The result could not be read. Try again.')
              update(id, { report: result }); completed = true
            }
          }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      if (!completed) throw new Error('The connection ended before your pick arrived. Try again.')
    } catch (failure) {
      update(id, { error: abort.signal.aborted ? abort.signal.reason === 'timeout' ? 'Analysis took too long. Try again.' : 'Analysis stopped.' : failure instanceof Error ? failure.message : 'Analysis failed. Try again.' })
    } finally { clearTimeout(timeout); if (sequence.current === id) { setBusy(false); controller.current = null } }
  }
  const preview = () => {
    if (busy) return
    const id = ++sequence.current
    setError(''); setBusy(true)
    setTurns(current => [...current, { id, url: '', image: null, filename: 'Example market', example: true, progress: { stage: 'market', label: 'Opening the example market' } }])
    const market = { title: 'Will Kansas City beat Buffalo?', outcomes: [{ name: 'Kansas City', price: .54 }, { name: 'Buffalo', price: .46 }], marketVerified: true }
    exampleTimers.current = [
      setTimeout(() => update(id, { progress: { ...market, stage: 'traders', label: 'Checking example positions' } }), 900),
      setTimeout(() => update(id, { progress: { ...market, stage: 'reasoning', label: 'Comparing the example sides', positionCount: 3, tradersAvailable: true } }), 1800),
      setTimeout(() => { update(id, { report: { title: market.title, action: 'BUY', outcome: 'Kansas City', price: .54, reason: 'The example trader activity favors Kansas City.', risk: 'A lineup change or a higher entry price.', evidence: [{ title: 'Two still holding.', detail: 'Two of three example buyers have no recorded exit.' }, { title: 'Entry matters.', detail: 'Your 54¢ quote is above the earliest example entry of 42¢.' }, { title: 'Lineup unverified.', detail: 'Check availability before acting on this example.' }], traders: [{ name: 'Field General', price: .42, outcome: 'Kansas City', exited: false }, { name: 'Sunday Sharp', price: .46, outcome: 'Kansas City', exited: false }], image: null, url: null, asOf: new Date().toISOString() } }); setBusy(false) }, 3000),
    ]
  }
  return <div className={`ac-page ${turns.length ? 'ac-has-turns' : ''}`}>
    <header className="ac-header"><span><Sparkles size={18} />Market analyzer</span><button onClick={() => { cancel(); setTurns([]); setError(''); setUrl(''); setImage(null); setFilename(''); sequence.current++ }} aria-label="New conversation"><Plus size={16} />New</button></header>
    <div className="ac-thread">
      {!turns.length && <div className="ac-empty"><div className="ac-assistant-icon"><Sparkles size={25} /></div><h1>What market are you looking at?</h1><p>Send a link or screenshot. I’ll break it down and pick a side.</p></div>}
      {turns.map(turn => <section className="ac-turn" key={turn.id}>
        <div className="ac-user-message">{turn.image && <img src={turn.image} alt="Your market screenshot" />}<span>{turn.example ? 'Analyze this example market' : turn.url || turn.filename}</span>{turn.example && <small>Fictional data · preview</small>}</div>
        <div className="ac-assistant-message"><div className="ac-assistant-label"><span className="ac-assistant-icon"><Sparkles size={14} /></span>VisibleTrader{turn.report && <small><Check size={12} />Complete</small>}</div>
          {turn.report ? <Result report={turn.report} example={turn.example} /> : turn.error ? <div className="ac-turn-error" role="alert"><p>{turn.error}</p><button onClick={() => { setUrl(turn.url); setImage(turn.image); setFilename(turn.filename); textInput.current?.focus() }}>Use this input again</button></div> : <Processing turn={turn} />}
        </div>
      </section>)}
      <div ref={bottom} />
    </div>
    <div className="ac-composer-wrap">
      <form className={`ac-composer ${dragging ? 'is-dragging' : ''}`} onSubmit={analyze} onDragOver={e => { e.preventDefault(); if (!busy) setDragging(true) }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); readFile(e.dataTransfer.files[0]) }}>
        {image && <div className="ac-attachment"><img src={image} alt="Attached screenshot" /><span>{filename}</span><button type="button" disabled={busy} aria-label="Remove screenshot" onClick={() => { setImage(null); setFilename('') }}><X size={14} /></button></div>}
        <label className="ac-sr-only" htmlFor="ac-input">Polymarket market link</label><input ref={textInput} id="ac-input" value={url} onChange={e => setUrl(e.target.value)} placeholder={turns.length ? 'Analyze another market…' : 'Paste a Polymarket link…'} disabled={busy} autoComplete="off" onPaste={e => { const file = Array.from(e.clipboardData.files)[0]; if (file) { e.preventDefault(); readFile(file) } }} />
        <div className="ac-composer-tools"><input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" disabled={busy} onChange={e => { readFile(e.target.files?.[0]); e.target.value = '' }} /><button type="button" className="ac-attach" onClick={() => input.current?.click()} disabled={busy}><ImagePlus size={17} /><span>Screenshot</span></button><span className="ac-input-hint"><Link2 size={12} />Polymarket</span>{busy ? <button type="button" className="ac-send" aria-label="Stop analysis" onClick={cancel}><Square size={13} fill="currentColor" /></button> : <button type="submit" className="ac-send" aria-label="Analyze market" disabled={!url.trim() && !image}><ArrowUp size={20} /></button>}</div>
      </form>
      {error && <p className="ac-input-error" role="alert">{error}</p>}
      {!turns.length && <button className="ac-preview-button" onClick={preview}>Try an example <ArrowUpRight size={12} /></button>}
    </div>
  </div>
}
