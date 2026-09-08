import { MarketIcon } from './MarketIcon'
import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Users } from 'lucide-react'
import type { ChartPoint, Opportunity } from './types'
import { categoryLabel, fetchMarketChart, fmtFull, fmtSigned } from './helpers'

function PickChart({ history, outcome, error, onRetry }: { history: ChartPoint[] | null; outcome: string; error: boolean; onRetry: () => void }) {
  let line = ''
  if (history && history.length > 1) {
    const minT = history[0].t
    const spanT = Math.max(1, history[history.length - 1].t - minT)
    const prices = history.map(p => p.p)
    const minP = Math.min(...prices)
    const spanP = Math.max(0.04, Math.max(...prices) - minP)
    line = history.map(p => `${6 + (p.t - minT) / spanT * 308},${88 - (p.p - minP) / spanP * 72}`).join(' ')
  }
  const endpoint = line.split(' ').at(-1)?.split(',')

  return (
    <div className="expert-pick-chart">
      {line ? (
        <svg viewBox="0 0 320 104" role="img" aria-label={`${outcome} price history, all available data`} preserveAspectRatio="none">
          {[16, 52, 88].map(y => <line key={y} x1="0" x2="320" y1={y} y2={y} className="expert-pick-gridline" />)}
          <polyline points={line} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
          {endpoint && <circle cx={endpoint[0]} cy={endpoint[1]} r="4" fill="currentColor" />}
        </svg>
      ) : <span role="status">{history === null ? 'Loading price history…' : error ? 'Couldn’t load chart' : 'Not enough price history yet'}{history !== null && <button type="button" className="expert-chart-retry" onClick={onRetry}>Retry</button>}</span>}
    </div>
  )
}

export function ExpertPickCard({ opportunity: o, onOpen }: { opportunity: Opportunity; onOpen: () => void }) {
  const container = useRef<HTMLElement>(null)
  const [history, setHistory] = useState<ChartPoint[] | null>(null)

  const [chartError, setChartError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const retry = () => { setHistory(null); setChartError(false); setAttempt(value => value + 1) }

  const [image, setImage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Only request history as a card approaches the viewport.
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return
      observer.disconnect()
      fetchMarketChart(o.condition_id, o.outcome).then(result => {
        if (!cancelled) {
          setHistory(result.history.filter(p => Number.isFinite(p.t) && Number.isFinite(p.p)).sort((a, b) => a.t - b.t))
          setChartError(result.error)
          if (result.image) setImage(result.image)
        }
      })
    }, { rootMargin: '200px' })
    if (container.current) observer.observe(container.current)
    return () => { cancelled = true; observer.disconnect() }
  }, [o.condition_id, o.outcome, attempt])

  const outcome = o.outcome.trim()
  const direction = outcome.toLowerCase()
  const label = direction === 'yes' || direction === 'no' ? direction.toUpperCase() : outcome

  return (
    <article ref={container} className="expert-pick-card">
      <div className="expert-pick-topline">
        <span>{categoryLabel(o.category ?? 'other')}</span>
        <a href={`https://polymarket.com/event/${encodeURIComponent(o.event_slug || o.slug)}`} target="_blank" rel="noopener noreferrer">View market <ArrowUpRight size={14} /></a>
      </div>
      <button className="expert-pick-title" onClick={onOpen}>
        <MarketIcon conditionId={o.condition_id} outcome={o.outcome} category={o.category} className="expert-pick-icon" source={image} />
        <h3>{o.title}</h3>
      </button>
      <div className="expert-pick-price"><span>{label} chance</span><strong>{Number((o.latest_price * 100).toFixed(1))}<small>%</small></strong></div>
      <PickChart history={history} outcome={o.outcome} error={chartError} onRetry={retry} />
      <div className="expert-pick-chart-caption"><span>Polymarket</span><span>All time</span></div>
      <div className="expert-pick-stats">
        <span><Users size={14} /> {o.wallet_count} {o.wallet_count === 1 ? 'expert' : 'experts'}</span>
        <span title="Total invested by tracked traders">{fmtFull(o.cumulative_usd)} invested</span>
        <span className={o.total_profit >= 0 ? 'g' : 'r'} title="Combined profit of tracked traders">{fmtSigned(o.total_profit)} profit</span>
      </div>
      <button className={`expert-pick-bet ${direction === 'no' ? 'is-no' : direction === 'yes' ? 'is-yes' : 'is-other'}`} onClick={onOpen} aria-label={`View expert pick: ${label} — ${o.title}`}>
        <span>Bet {label}</span><ArrowUpRight size={18} />
      </button>
    </article>
  )
}
