import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowUp, ArrowUpRight, Check, ChevronDown, Globe, ImagePlus, Link2, Plus, Square, Users, X } from 'lucide-react'
import { supabase, supabaseFunctionsUrl } from '../../lib/supabase'
import './analyzer.css'

type Source = { id: number; title: string; url: string; domain: string; cited: boolean }
type Report = {
  title: string; action: 'BUY'; outcome: string; price: number | null; reason: string; risk: string
  evidence: { title: string; detail: string; basis?: 'web' | 'market' | 'traders' | 'uncertain'; source_ids?: number[] }[]
  traders: { name: string; price: number; outcome: string; exited: boolean }[]
  image: string | null; url: string | null; asOf: string
  sources?: Source[]; researchStatus?: 'complete' | 'unavailable' | 'no_sources'; searches?: number; positionCount?: number; investedUsd?: number | null
  reason_source_ids?: number[]; risk_source_ids?: number[]
}
type Progress = {
  stage: 'connecting' | 'market' | 'traders' | 'research' | 'reasoning'
  label: string; title?: string; image?: string | null; marketVerified?: boolean
  outcomes?: { name: string; price: number | null }[]; positionCount?: number; tradersAvailable?: boolean
  sources?: Source[]; searches?: number; researchStatus?: Report['researchStatus']
}
type Turn = { id: number; url: string; image: string | null; filename: string; progress: Progress; report?: Report; error?: string; example?: boolean }
const cents = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}¢`
const percent = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`
const dollars = (value: number | null | undefined) => value && value > 0 ? `$${Math.round(value).toLocaleString()}` : '—'

function Citations({ ids = [], sources = [] }: { ids?: number[]; sources?: Source[] }) {
  return <span className="ac-citations">{ids.map(id => {
    const source = sources.find(s => s.id === id && s.cited)
    return source ? <a key={id} href={source.url} target="_blank" rel="noreferrer" title={source.title} aria-label={`Source ${id}: ${source.title}`}>{id}</a> : null
  })}</span>
}

function SourceTile({ source }: { source: Source }) {
  return <a className="ac-source-tile" href={source.url} target="_blank" rel="noreferrer">
    <span className="ac-source-avatar">{source.domain.slice(0, 1).toUpperCase()}</span>
    <div><span>{source.domain}</span><strong>{source.title}</strong></div><ArrowUpRight size={13} />
  </a>
}

function Processing({ turn }: { turn: Turn }) {
  const { progress: p } = turn
  const preview = p.image || turn.image
  const sources = p.sources || []
  return <div className="ac-processing" aria-label="Analysis in progress">
    <div className="ac-live-status" role="status"><span key={p.label}>{p.label}</span><span className="ac-search-dots" aria-hidden="true"><i /><i /><i /></span></div>
    {(p.title || preview) && <div className="ac-market-preview">
      {preview && <img src={preview} alt="Market being analyzed" />}
      <div><small>{turn.example ? 'Example market' : p.marketVerified ? 'Polymarket' : 'Your screenshot'}</small><strong>{p.title || 'Reading your market…'}</strong>
        <div className="ac-market-quotes">{p.outcomes?.slice(0, 2).map(o => <span key={o.name}>{o.name} <b>{cents(o.price)}</b></span>)}</div>
      </div>
    </div>}

    {sources.length > 0 && <div className="ac-discoveries"><div className="ac-discoveries-heading"><Globe size={14} />Coverage found <span>{sources.length}</span></div><div className="ac-source-list">{sources.slice(-4).map(source => <SourceTile key={source.id} source={source} />)}</div></div>}

  </div>
}

function Result({ report, example }: { report: Report; example?: boolean }) {
  const sources = report.sources || []
  const webUnavailable = report.researchStatus === 'unavailable' || report.researchStatus === 'no_sources'
  return <div className="ac-result">
    <a className="ac-pick-card ac-pick-link" href={report.url || 'https://polymarket.com'} target="_blank" rel="noreferrer" aria-label={report.url ? `Open ${report.title} on Polymarket` : 'Open Polymarket'}>
      <div className="ac-pick-brand"><span><span className="ac-brand-bars" aria-hidden="true"><i /><i /><i /></span>VisibleTrader</span></div>
      <div className="ac-pick-market">{report.image && <img src={report.image} alt="" />}<h2>{report.title}</h2></div>
      <div className="ac-pick-outcome"><ArrowUpRight size={23} /><span>Buy {report.outcome}</span></div>
      <div className="ac-pick-stats"><div><span>Market price</span><strong>{percent(report.price)}</strong></div><div className="ac-expert-stat"><span>Expert traders</span><strong>{report.traders.length}</strong></div><div className="ac-invested-stat"><span>Invested on this side</span><strong>{dollars(report.investedUsd)}</strong></div></div>
      <div className="ac-pick-bottom"><span>{example ? 'Fictional example' : 'Recommendation · no trade placed'}</span><span className="ac-pick-destination">{report.url ? 'Open market' : 'Explore Polymarket'} <ArrowUpRight size={13} /></span></div>
    </a>
    <p className="ac-reason">{report.reason}<Citations ids={report.reason_source_ids} sources={sources} /></p>
    <div className="ac-reasons-row">{report.evidence.slice(0, 3).map((item, i) => {
      return <article className="ac-reason-item" key={i}><h3>{item.title}</h3><p>{item.detail}<Citations ids={item.source_ids} sources={sources} /></p></article>
    })}</div>
    {webUnavailable && <p className="ac-research-warning">{report.researchStatus === 'unavailable' ? 'Web research unavailable.' : 'No usable outside sources found.'} Pick uses market context only.</p>}
    {sources.length > 0 && <details className="ac-sources-drawer"><summary><span className="ac-source-stack">{sources.slice(0, 4).map(s => <i key={s.id}>{s.domain.slice(0, 1).toUpperCase()}</i>)}</span><span>{sources.length} sources found</span><ChevronDown size={14} /></summary><div className="ac-source-list">{sources.map(source => <div key={source.id}><SourceTile source={source} /><small>{source.cited ? 'Cited in research' : 'Search result · not cited'}</small></div>)}</div></details>}
    {report.traders.length > 0 && <details className="ac-trader-details"><summary><Users size={15} />Expert traders on this side <b>{report.traders.length}</b><ChevronDown size={14} /></summary><div>{report.traders.map((t, i) => <div className="ac-trader" key={i}><span>{t.name.slice(0, 2).toUpperCase()}</span><strong>{t.name}</strong><small>{t.exited ? 'Exited' : 'No recorded exit'}</small><b>{percent(t.price)}</b></div>)}</div></details>}
    <p className="ac-risk"><span>Watch for</span><span>{report.risk}<Citations ids={report.risk_source_ids} sources={sources} /></span></p>
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
    const timeout = setTimeout(() => abort.abort('timeout'), 145000)
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
    const sources: Source[] = [
      { id: 1, domain: 'example.com', url: 'https://example.com', title: 'Example: team availability report', cited: true },
      { id: 2, domain: 'example.org', url: 'https://example.org', title: 'Example: matchup form guide', cited: true },
    ]
    exampleTimers.current = [
      setTimeout(() => update(id, { progress: { ...market, stage: 'traders', label: 'Checking example positions' } }), 900),
      setTimeout(() => update(id, { progress: { ...market, stage: 'research', label: 'Finding example coverage', positionCount: 3, tradersAvailable: true, sources, searches: 2 } }), 1800),
      setTimeout(() => update(id, { progress: { ...market, stage: 'reasoning', label: 'Weighing the example evidence', positionCount: 3, tradersAvailable: true, sources, searches: 2 } }), 3000),
      setTimeout(() => { update(id, { report: { title: market.title, action: 'BUY', outcome: 'Kansas City', price: .54, reason: 'The example trader activity favors Kansas City.', risk: 'A lineup change or a higher entry price.', evidence: [{ title: 'Two still holding.', detail: 'Two of three example buyers have no recorded exit.', basis: 'traders' }, { title: 'Entry matters.', detail: 'Your 54¢ quote is above the earliest example entry of 42¢.', basis: 'market' }, { title: 'Lineup unverified.', detail: 'This fictional report illustrates where a linked availability update would appear.', basis: 'uncertain', source_ids: [] }], traders: [{ name: 'Field General', price: .42, outcome: 'Kansas City', exited: false }, { name: 'Sunday Sharp', price: .46, outcome: 'Kansas City', exited: false }], image: null, url: null, asOf: new Date().toISOString(), sources, searches: 2, positionCount: 3, investedUsd: 12840, researchStatus: 'complete' } }); setBusy(false) }, 4000),
    ]
  }
  return <div className={`ac-page ${turns.length ? 'ac-has-turns' : ''}`}>
    <header className="ac-header"><span>Market analyzer</span><button onClick={() => { cancel(); setTurns([]); setError(''); setUrl(''); setImage(null); setFilename(''); sequence.current++ }} aria-label="New conversation"><Plus size={16} />New</button></header>
    <div className="ac-thread">
      {!turns.length && <div className="ac-empty"><h1>What’s your next move?</h1><p>Drop a Polymarket link or screenshot. Get a researched pick.</p></div>}
      {turns.map(turn => <section className="ac-turn" key={turn.id}>
        <div className="ac-user-message">{turn.image && <img src={turn.image} alt="Your market screenshot" />}<span>{turn.example ? 'Analyze this example market' : turn.url || turn.filename}</span>{turn.example && <small>Fictional data · preview</small>}</div>
        <div className="ac-assistant-message"><div className="ac-assistant-label">VisibleTrader{turn.report && <small><Check size={12} />Complete</small>}</div>
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
