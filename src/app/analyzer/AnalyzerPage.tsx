import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { ArrowUp, ArrowUpRight, ChevronDown, Globe, ImagePlus, Link2, RotateCcw, Search, Square, Users } from 'lucide-react'
import { supabase, supabaseFunctionsUrl } from '../../lib/supabase'
import { MarketSparkline } from './MarketSparkline'
import type { ChartPoint } from '../types'
import '../expert-pick-card.css'
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

function SourceIcon({ source }: { source: Source }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  let iconUrl: string | null = null
  let isPolymarket = false
  try {
    const url = new URL(source.url)
    isPolymarket = ['polymarket.com', 'www.polymarket.com', 'polymarket.us', 'www.polymarket.us'].includes(url.hostname)
    if (url.protocol === 'https:') iconUrl = new URL('/favicon.ico', url.origin).href
  } catch { /* Keep the letter fallback for invalid source URLs. */ }
  return <span className={`ac-source-avatar${isPolymarket ? ' ac-source-polymarket' : ''}`} aria-hidden="true">
    {(!iconUrl || loadedUrl !== iconUrl || failedUrl === iconUrl) && source.domain.slice(0, 1).toUpperCase()}
    {iconUrl && failedUrl !== iconUrl && <img key={iconUrl} src={iconUrl} alt="" loading="lazy" referrerPolicy="no-referrer" onLoad={() => setLoadedUrl(iconUrl)} onError={() => setFailedUrl(iconUrl)} />}
  </span>
}

function SourceTile({ source }: { source: Source }) {
  return <a className="ac-source-tile" href={source.url} target="_blank" rel="noreferrer">
    <SourceIcon source={source} />
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
        <div className="ac-market-quotes">{progress.outcomes?.slice(0, 2).map(o => <span key={o.name}>{o.name} <b>{percent(o.price)}</b></span>)}</div>
      </div>
    </div>}
    {sources.length > 0 && <div className="ac-discoveries"><div className="ac-discoveries-heading"><Globe size={14} />Coverage found <span>{sources.length}</span></div><div className="ac-source-list">{sources.slice(-4).map(source => <SourceTile key={source.id} source={source} />)}</div></div>}
  </div>
}

// A pasted event link can't point at one specific sub-market — Polymarket's
// spread/total lines are tabs on one page, the URL never changes — so when
// the backend can't narrow to a single market it hands back every market in
// the event instead of silently guessing one. This lets the user say which
// one they meant; picking a card resubmits with that market's own link,
// which resolves unambiguously.
function MarketPick({ options, onPick }: { options: PickOption[]; onPick: (url: string) => void }) {
  const [group, setGroup] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const groups = [...new Set(options.map(option => option.group))]
  const filtered = options.filter(option => (group === null || option.group === group)
    && `${option.title} ${option.group} ${option.outcomes.map(o => o.name).join(' ')}`.toLowerCase().includes(query.trim().toLowerCase()))
  return <div className="ac-market-pick" aria-label="Choose a market to analyze">
    <div className="ac-picker-intro"><span className="ac-eyebrow">Choose your market</span><h1>What would you like to analyze?</h1><p>Select a market to get a pick and the research behind it.</p></div>
    <div className="ac-market-filters" aria-label="Market categories">
      <button type="button" aria-pressed={group === null} onClick={() => setGroup(null)}>All <span>{options.length}</span></button>
      {groups.length > 1 && groups.map(name => <button type="button" key={name} aria-pressed={group === name} onClick={() => setGroup(name)}>{name} <span>{options.filter(option => option.group === name).length}</span></button>)}
    </div>
    <label className="ac-market-search"><Search size={17} /><span className="ac-sr-only">Search markets</span><input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Search markets…" /></label>
    <p className="ac-market-count" role="status">{filtered.length} {filtered.length === 1 ? 'market' : 'markets'}</p>
    {groups.map(name => {
      const items = filtered.filter(option => option.group === name)
      return items.length > 0 && <section className="ac-market-pick-section" key={name}>
        <h2 className="ac-market-pick-group">{name}</h2>
        <ul className="ac-market-grid">{items.map(option => <li key={option.url}>
          <article className="expert-pick-card ac-market-card">
            <div className="expert-pick-topline"><span>{option.group}</span><span className="ac-market-card-logos">{option.images.filter(Boolean).slice(0, 2).map((src, i) => <img key={i} src={src!} alt="" loading="lazy" />)}</span></div>
            <button type="button" className="expert-pick-title" onClick={() => onPick(option.url)}><h3>{option.title}</h3></button>
            <MarketSparkline key={`${option.url}:${option.outcomes[0]?.name}`} url={option.url} outcome={option.outcomes[0]?.name || ''} price={option.outcomes[0]?.price ?? null} />
            <div className="expert-pick-evidence"><div className="expert-pick-stats ac-market-outcomes">{option.outcomes.slice(0, 2).map(o => <span key={o.name}><strong>{percent(o.price)}</strong><small>{o.name}</small></span>)}</div></div>
            <button type="button" className="expert-pick-bet is-other" onClick={() => onPick(option.url)} aria-label={`Analyze ${option.title}`}><span>Analyze market</span><ArrowUpRight size={16} /></button>
          </article>
        </li>)}</ul>
      </section>
    })}
    {filtered.length === 0 && <div className="ac-market-empty"><strong>No matching markets</strong><p>Try another search or category.</p><button type="button" onClick={() => { setQuery(''); setGroup(null) }}>Clear filters</button></div>}
  </div>
}

// Mirrors ExpertPickCard's visual language (src/app/expert-pick-card.css) —
// flat bordered surface, topline + title, 3-stat row, colored bet pill —
// so a market analyzed here looks like it belongs next to the tracked-trader
// picks feed instead of like a different tool bolted onto the app.
// Yes/No map to the same green/red CumulativePickChart already uses for
// up/down P&L, so the chart's color reinforces the same call the badge and
// bet button make — a named-outcome pick ("Milwaukee Brewers") has no
// inherent up/down sense, so it keeps the component's original blue.
const CHART_ACCENT: Record<string, { line: string; bright: string } | undefined> = {
  'is-yes': { line: '#00d17a', bright: '#00d17a' },
  'is-no': { line: '#ff3b5c', bright: '#ff3b5c' },
  'is-other': undefined,
}

function Result({ report, onReset }: { report: Report; onReset: () => void }) {
  const [showAllTraders, setShowAllTraders] = useState(false)
  const sources = report.sources || []
  const citedSources = sources.filter(source => source.cited)
  const visibleTraders = showAllTraders ? report.traders : report.traders.slice(0, 3)
  const webUnavailable = report.researchStatus === 'unavailable' || report.researchStatus === 'no_sources'
  const direction = report.outcome.trim().toLowerCase()
  const betClass = direction === 'no' ? 'is-no' : direction === 'yes' ? 'is-yes' : 'is-other'
  return <div className="ac-result">
    <header className="ac-result-header"><span className="ac-eyebrow">Your analysis</span><button className="ac-again" onClick={onReset}><RotateCcw size={14} />Analyze another</button></header>
    <div className="ac-result-layout">
    <article className="ac-pick-card">
      <div className="ac-pick-topline"><span>VisibleTrader pick</span>{report.url && <a href={report.url} target="_blank" rel="noreferrer">View market <ArrowUpRight size={13} /></a>}</div>
      <div className="ac-pick-title">
        {report.image && <img src={report.image} alt="" />}
        <div><h2>{report.title}</h2><span className={`ac-pick-badge ${betClass}`}>{report.outcome}</span></div>
      </div>
      <MarketSparkline key={`${report.url}:${report.outcome}`} url={report.url || ''} initialHistory={report.history} outcome={report.outcome} price={report.price} accent={CHART_ACCENT[betClass]} filled />
      <div className="ac-pick-stats">
        <span><strong>{percent(report.price)}</strong><small>market price</small></span>
        <span className="g"><strong>{dollars(report.investedUsd)}</strong><small>{report.investedUsd ? 'invested' : 'no positions'}</small></span>
        <span><strong><Users size={14} /> {report.traders.length}</strong><small>{report.traders.length === 1 ? 'trader' : 'traders'}</small></span>
      </div>
      <a className={`ac-pick-bet ${betClass}`} href={report.url || 'https://polymarket.com'} target="_blank" rel="noreferrer" aria-label={`Open market: Bet ${report.outcome} on ${report.title}`}>
        <span>Bet {report.outcome}</span><ArrowUpRight size={18} />
      </a>
    </article>
    <div className="ac-research">
      <section className="ac-summary"><h2>Why this pick</h2><p>{report.reason}<Citations ids={report.reason_source_ids} sources={sources} /></p></section>
      <section className="ac-evidence"><h2>Key evidence</h2>
        {report.evidence.map((item, i) => {
          const references = sources.filter(source => source.cited && item.source_ids?.includes(source.id))
          return <article className="ac-finding" key={i}><h3>{item.title}</h3><p>{item.detail}</p>
            {references.length > 0 && <div className="ac-finding-sources">{references.map(source => <a key={source.id} href={source.url} target="_blank" rel="noreferrer" title={source.title}><SourceIcon source={source} />{source.domain}<ArrowUpRight size={12} /></a>)}</div>}
          </article>
        })}
      </section>
      {webUnavailable && <p className="ac-research-warning">{report.researchStatus === 'unavailable' ? 'Web research unavailable.' : 'No usable outside sources found.'} Pick uses market context only.</p>}
      <section className="ac-risk"><h2>What could change the call</h2><p>{report.risk}<Citations ids={report.risk_source_ids} sources={sources} /></p></section>
    </div>
    </div>
    {report.traders.length > 0 && <section className="ac-traders-section"><div className="ac-section-heading"><h2>Traders holding this outcome</h2><span>{report.traders.length}</span></div>
      <div className="ac-trader-list">{visibleTraders.map((trader, i) => <div className="ac-trader" key={`${trader.name}-${i}`}><span className="ac-trader-avatar" aria-hidden="true">{trader.name.slice(0, 2).toUpperCase()}</span><strong>{trader.name}</strong><span className="ac-trader-position">Holding <b>{trader.outcome}</b></span></div>)}</div>
      {report.traders.length > 3 && <button type="button" className="ac-view-traders" aria-expanded={showAllTraders} onClick={() => setShowAllTraders(value => !value)}>{showAllTraders ? 'Show fewer traders' : `View all ${report.traders.length} traders`}<ChevronDown size={14} /></button>}
    </section>}
    {sources.length > 0 && <details className="ac-sources-drawer"><summary><Globe size={15} /><span>{citedSources.length} cited {citedSources.length === 1 ? 'source' : 'sources'} · {sources.length} found</span><ChevronDown size={14} /></summary><div className="ac-source-list">{sources.map(source => <div key={source.id}><SourceTile source={source} /><small>{source.cited ? 'Cited in research' : 'Search result · not cited'}</small></div>)}</div></details>}
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
  const output = useRef<HTMLDivElement>(null)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])
  const screen = report ? 'result' : runError ? 'error' : pickOptions ? 'picker' : progress ? 'processing' : 'start'
  useEffect(() => { if (screen !== 'start') output.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' }) }, [screen])

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
    {hasRun && <div className="ac-output" ref={output}>
      {report ? <Result report={report} onReset={reset} />
        : runError ? <div className="ac-run-error" role="alert"><p>{runError}</p><button onClick={reset}><RotateCcw size={14} />Try again</button></div>
        : pickOptions ? <MarketPick options={pickOptions} onPick={pickUrl => { setPickOptions(null); start(pickUrl, null) }} />
        : progress ? <><Processing progress={progress} image={submittedImage} /><button type="button" className="ac-stop" onClick={cancel}><Square size={12} fill="currentColor" />Stop</button></> : null}
    </div>}
  </div>
}
