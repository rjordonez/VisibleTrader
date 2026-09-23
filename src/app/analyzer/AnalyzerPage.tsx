import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowUp, ArrowUpRight, ChevronDown, Globe, ImagePlus, Link2, RotateCcw, Square, Users } from 'lucide-react'
import { supabase, supabaseFunctionsUrl } from '../../lib/supabase'
import { PickChart } from '../PickChart'
import type { ChartPoint } from '../types'
import './analyzer.css'

type Source = { id: number; title: string; url: string; domain: string; cited: boolean }
type Report = {
  title: string; action: 'BUY'; outcome: string; price: number | null; reason: string; risk: string
  evidence: { title: string; detail: string; basis?: 'web' | 'market' | 'traders' | 'uncertain'; source_ids?: number[] }[]
  traders: { name: string; price: number; outcome: string }[]
  image: string | null; url: string | null; asOf: string
  sources?: Source[]; researchStatus?: 'complete' | 'unavailable' | 'no_sources'; searches?: number; positionCount?: number; investedUsd?: number | null
  reason_source_ids?: number[]; risk_source_ids?: number[]; history?: ChartPoint[]
}
type Progress = {
  stage: 'connecting' | 'market' | 'traders' | 'research' | 'reasoning'
  label: string; title?: string; image?: string | null; marketVerified?: boolean
  outcomes?: { name: string; price: number | null }[]; positionCount?: number; tradersAvailable?: boolean
  sources?: Source[]; searches?: number; researchStatus?: Report['researchStatus']
}
type PickOption = { url: string; title: string; images: (string | null)[]; outcomes: { name: string; price: number | null }[]; group: string }
const cents = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}¢`
const percent = (value: number | null) => value === null ? '—' : `${Math.round(value * 100)}%`
const dollars = (value: number | null | undefined) => value && value > 0 ? `$${Math.round(value).toLocaleString()}` : '—'

// A retina full-screen Mac screenshot easily runs several MB, and that size
// (not the code that reads it) is what was making screenshot uploads take
// forever — confirmed live: a small cropped screenshot analyzed instantly,
// a full-res one sat "Connecting…" indefinitely. The model only needs
// ~1568px on the long edge (OpenAI's own high-detail vision guidance) —
// well past that resolution buys no analysis quality, just a slower upload.
// Downscaling client-side before upload fixes this for every screenshot,
// not just ones the user happens to crop manually.
const MAX_IMAGE_EDGE = 1568
function downscaleImage(dataUrl: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(img.width, img.height))
      if (scale === 1) { resolve(dataUrl); return }
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      const ctx = canvas.getContext('2d')
      if (!ctx) { resolve(dataUrl); return }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', 0.85))
    }
    img.onerror = () => reject(new Error('Could not decode image'))
    img.src = dataUrl
  })
}

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

function Processing({ progress, image }: { progress: Progress; image: string | null }) {
  const preview = progress.image || image
  const sources = progress.sources || []
  return <div className="ac-processing" aria-label="Analysis in progress">
    <div className="ac-live-status" role="status"><span key={progress.label}>{progress.label}</span><span className="ac-search-dots" aria-hidden="true"><i /><i /><i /></span></div>
    {(progress.title || preview) && <div className="ac-market-preview">
      {preview && <img src={preview} alt="Market being analyzed" />}
      <div><small>{progress.marketVerified ? 'Polymarket' : 'Your screenshot'}</small><strong>{progress.title || 'Reading your market…'}</strong>
        <div className="ac-market-quotes">{progress.outcomes?.slice(0, 2).map(o => <span key={o.name}>{o.name} <b>{cents(o.price)}</b></span>)}</div>
      </div>
    </div>}
    {sources.length > 0 && <div className="ac-discoveries"><div className="ac-discoveries-heading"><Globe size={14} />Coverage found <span>{sources.length}</span></div><div className="ac-source-list">{sources.slice(-4).map(source => <SourceTile key={source.id} source={source} />)}</div></div>}
  </div>
}

// A pasted event link can't point at one specific sub-market — Polymarket's
// spread/total lines are tabs on one page, the URL never changes — so when
// the backend can't narrow to a single market it hands back every market in
// the event instead of silently guessing one. This lets the user say which
// one they meant; picking a row resubmits with that market's own link,
// which resolves unambiguously.
function MarketPick({ options, onPick }: { options: PickOption[]; onPick: (url: string) => void }) {
  // Options arrive already grouped consecutively by market family (Moneyline
  // / Spread / Totals / Other) — folding them into sections here keeps both
  // teams' sides of the same spread line together instead of scattered
  // across the grid by price or volume.
  const sections: { group: string; items: PickOption[] }[] = []
  for (const option of options) {
    const last = sections[sections.length - 1]
    if (last?.group === option.group) last.items.push(option)
    else sections.push({ group: option.group, items: [option] })
  }
  return <div className="ac-market-pick" aria-label="Choose a market to analyze">
    <h1 className="ac-market-pick-heading">Pick a Market</h1>
    {sections.map(section => (
      <div className="ac-market-pick-section" key={section.group}>
        {sections.length > 1 && <h2 className="ac-market-pick-group">{section.group}</h2>}
        <div className="ac-market-pick-grid" role="list">
          {section.items.map((option, i) => (
            <button type="button" className="ac-market-pick-item" key={i} onClick={() => onPick(option.url)} role="listitem">
              {option.images.some(Boolean) && <div className="ac-market-pick-logos">{option.images.filter(Boolean).slice(0, 2).map((src, j) => <img key={j} src={src!} alt="" />)}</div>}
              <strong>{option.title}</strong>
              <div className="ac-market-quotes">{option.outcomes.slice(0, 2).map(o => <span key={o.name}>{o.name} <b>{cents(o.price)}</b></span>)}</div>
            </button>
          ))}
        </div>
      </div>
    ))}
  </div>
}

// Mirrors ExpertPickCard's visual language (src/app/expert-pick-card.css) —
// flat bordered surface, topline + title, 3-stat row, colored bet pill —
// so a market analyzed here looks like it belongs next to the tracked-trader
// picks feed instead of like a different tool bolted onto the app.
function Result({ report, onReset }: { report: Report; onReset: () => void }) {
  const sources = report.sources || []
  const webUnavailable = report.researchStatus === 'unavailable' || report.researchStatus === 'no_sources'
  const direction = report.outcome.trim().toLowerCase()
  const betClass = direction === 'no' ? 'is-no' : direction === 'yes' ? 'is-yes' : 'is-other'
  return <div className="ac-result">
    <article className="ac-pick-card">
      <div className="ac-pick-topline"><span>VisibleTrader pick</span>{report.url && <a href={report.url} target="_blank" rel="noreferrer">View market <ArrowUpRight size={13} /></a>}</div>
      <div className="ac-pick-title">{report.image && <img src={report.image} alt="" />}<h2>{report.title}</h2></div>
      <PickChart history={report.history?.length ? report.history : []} outcome={report.outcome} price={report.price ?? 0} error={!report.history?.length} onRetry={() => {}} />
      <div className="ac-pick-chart-caption"><span>Polymarket</span><span>All time</span></div>
      <div className="ac-pick-stats">
        <span><strong>{percent(report.price)}</strong><small>market price</small></span>
        <span className="g"><strong>{dollars(report.investedUsd)}</strong><small>invested</small></span>
        <span><strong><Users size={14} /> {report.traders.length}</strong><small>{report.traders.length === 1 ? 'expert' : 'experts'}</small></span>
      </div>
      <a className={`ac-pick-bet ${betClass}`} href={report.url || 'https://polymarket.com'} target="_blank" rel="noreferrer" aria-label={`Open market: Bet ${report.outcome} on ${report.title}`}>
        <span>Bet {report.outcome}</span><ArrowUpRight size={18} />
      </a>
    </article>
    <button className="ac-again" onClick={onReset}><RotateCcw size={14} />Analyze another</button>
    <p className="ac-reason">{report.reason}<Citations ids={report.reason_source_ids} sources={sources} /></p>
    <div className="ac-reasons-row">{report.evidence.slice(0, 3).map((item, i) => {
      return <article className="ac-reason-item" key={i}><h3>{item.title}</h3><p>{item.detail}<Citations ids={item.source_ids} sources={sources} /></p></article>
    })}</div>
    {webUnavailable && <p className="ac-research-warning">{report.researchStatus === 'unavailable' ? 'Web research unavailable.' : 'No usable outside sources found.'} Pick uses market context only.</p>}
    {sources.length > 0 && <details className="ac-sources-drawer"><summary><span className="ac-source-stack">{sources.slice(0, 4).map(s => <i key={s.id}>{s.domain.slice(0, 1).toUpperCase()}</i>)}</span><span>{sources.length} sources found</span><ChevronDown size={14} /></summary><div className="ac-source-list">{sources.map(source => <div key={source.id}><SourceTile source={source} /><small>{source.cited ? 'Cited in research' : 'Search result · not cited'}</small></div>)}</div></details>}
    {report.traders.length > 0 && <details className="ac-trader-details"><summary><Users size={15} />Expert traders on this side <b>{report.traders.length}</b><ChevronDown size={14} /></summary><div>{report.traders.map((t, i) => <div className="ac-trader" key={i}><span>{t.name.slice(0, 2).toUpperCase()}</span><strong>{t.name}</strong><small>Currently holding</small><b>{percent(t.price)}</b></div>)}</div></details>}
    <p className="ac-risk"><span>Watch for</span><span>{report.risk}<Citations ids={report.risk_source_ids} sources={sources} /></span></p>
    <footer><span>{report.price === null ? 'Price unverified' : 'Price snapshot'} · {new Date(report.asOf).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></footer>
  </div>
}

export default function AnalyzerPage() {
  const [url, setUrl] = useState('')
  const [submittedImage, setSubmittedImage] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [pickOptions, setPickOptions] = useState<PickOption[] | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [inputError, setInputError] = useState('')
  const [dragging, setDragging] = useState(false)
  const [starting, setStarting] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const linkInput = useRef<HTMLInputElement>(null)
  const bottom = useRef<HTMLDivElement>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { if (progress || report || runError || pickOptions) bottom.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'end' }) }, [progress, report, runError, pickOptions])

  const run = async (runUrl: string, runImage: string | null) => {
    const abort = new AbortController()
    controller.current = abort
    setSubmittedImage(runImage)
    setProgress({ stage: 'connecting', label: 'Connecting to your market' })
    setReport(null); setRunError(null); setPickOptions(null); setBusy(true); setInputError('')
    setUrl('')
    const timeout = setTimeout(() => abort.abort('timeout'), 145000)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) throw new Error('Sign in to analyze a market.')
      const response = await fetch(`${supabaseFunctionsUrl}/analyze-market`, {
        method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
        body: JSON.stringify({ url: runUrl || null, image: runImage }), signal: abort.signal,
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
            if (message.type === 'progress') setProgress(current => ({ ...current, ...message } as Progress))
            if (message.type === 'choose') { setPickOptions(message.markets); setProgress(null); completed = true }
            if (message.type === 'result') {
              const result = message.report
              if (result?.action !== 'BUY' || typeof result.outcome !== 'string' || !Array.isArray(result.evidence) || !Array.isArray(result.traders)) throw new Error('The result could not be read. Try again.')
              setReport(result); completed = true
            }
          }
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      if (!completed) throw new Error('The connection ended before your pick arrived. Try again.')
    } catch (failure) {
      setRunError(abort.signal.aborted ? abort.signal.reason === 'timeout' ? 'Analysis took too long. Try again.' : 'Analysis stopped.' : failure instanceof Error ? failure.message : 'Analysis failed. Try again.')
    } finally { clearTimeout(timeout); setBusy(false); controller.current = null }
  }

  // A short beat where the drop box visibly collapses before the progress
  // view takes over — "submit" reads as one deliberate transition instead of
  // the box just vanishing and being replaced instantly.
  const start = (runUrl: string, runImage: string | null) => {
    if (busy || starting) return
    setStarting(true)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setTimeout(() => { setStarting(false); run(runUrl, runImage) }, reduced ? 0 : 220)
  }

  const readFile = (file?: File) => {
    if (!file || busy || starting) return
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024) { setInputError('Choose a PNG, JPG, or WebP under 20 MB.'); return }
    setInputError('')
    const reader = new FileReader()
    reader.onload = async () => {
      const raw = String(reader.result)
      try { start('', await downscaleImage(raw)) } catch { start('', raw) }
    }
    reader.onerror = () => setInputError('This image could not be opened.')
    reader.readAsDataURL(file)
  }

  const submitLink = (event: FormEvent) => {
    event.preventDefault()
    if (busy || starting) return
    const trimmed = url.trim()
    if (!trimmed) { setInputError('Paste a market link or drop a screenshot.'); return }
    // Accepts both polymarket.com and polymarket.us — which one is invisible
    // to the user, the backend picks the right API for whichever they paste.
    // .com uses /event/{slug} and /market/{slug}, but also category-prefixed
    // paths like /sports/mlb/{slug} (confirmed live) — same shape .us always
    // uses — so both just need a real trailing path segment.
    try {
      const p = new URL(trimmed)
      const isUS = p.hostname === 'polymarket.us' || p.hostname === 'www.polymarket.us'
      const validHost = isUS || p.hostname === 'polymarket.com' || p.hostname === 'www.polymarket.com'
      const pathOk = p.pathname.split('/').filter(Boolean).length >= 1
      if (p.protocol !== 'https:' || !validHost || !pathOk) throw new Error()
    }
    catch { setInputError('Use a full Polymarket event or market link.'); return }
    start(trimmed, null)
  }

  const cancel = () => {
    controller.current?.abort()
    if (busy) setRunError('Analysis stopped.')
    setBusy(false)
  }
  const reset = () => {
    cancel()
    setUrl(''); setSubmittedImage(null)
    setProgress(null); setReport(null); setRunError(null); setPickOptions(null); setInputError(''); setStarting(false)
  }

  const hasRun = !!(progress || report || runError || pickOptions)
  return <div className={`ac-page ${hasRun ? 'ac-has-run' : ''}`}>
    {!hasRun && <div className="ac-start">
      <h1>Analyze any Polymarket pick</h1>
      <div
        className={`ac-drop ${dragging ? 'is-dragging' : ''} ${starting ? 'is-starting' : ''}`}
        onClick={() => input.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.current?.click() } }}
        role="button" tabIndex={0} aria-label="Upload a screenshot of a Polymarket market"
        onDragOver={e => { e.preventDefault(); if (!busy && !starting) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); readFile(e.dataTransfer.files[0]) }}
      >
        <input ref={input} type="file" hidden accept="image/png,image/jpeg,image/webp" disabled={busy || starting} onChange={e => { readFile(e.target.files?.[0]); e.target.value = '' }} />
        <ImagePlus size={30} />
        <strong>Drop or upload a screenshot of the market</strong>
        <span>PNG, JPG, or WebP · up to 4MB</span>
      </div>
      <form className="ac-link-row" onSubmit={submitLink}>
        <Link2 size={13} />
        <label className="ac-sr-only" htmlFor="ac-link">Or paste a Polymarket market link</label>
        <input ref={linkInput} id="ac-link" value={url} onChange={e => setUrl(e.target.value)} placeholder="or paste a Polymarket link" disabled={busy || starting} autoComplete="off"
          onPaste={e => { const file = Array.from(e.clipboardData.files)[0]; if (file) { e.preventDefault(); readFile(file) } }} />
        <button type="submit" aria-label="Analyze market" disabled={!url.trim() || busy || starting}><ArrowUp size={15} /></button>
      </form>
      {inputError && <p className="ac-input-error" role="alert">{inputError}</p>}
    </div>}
    {hasRun && <div className="ac-output">
      {report ? <Result report={report} onReset={reset} />
        : runError ? <div className="ac-run-error" role="alert"><p>{runError}</p><button onClick={reset}><RotateCcw size={14} />Try again</button></div>
        : pickOptions ? <MarketPick options={pickOptions} onPick={pickUrl => { setPickOptions(null); start(pickUrl, null) }} />
        : progress ? <><Processing progress={progress} image={submittedImage} /><button type="button" className="ac-stop" onClick={cancel}><Square size={12} fill="currentColor" />Stop</button></> : null}
    </div>}
    <div ref={bottom} />
  </div>
}
