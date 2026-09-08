import { MarketIcon } from './MarketIcon'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, Users } from 'lucide-react'
import type { ChartPoint, Opportunity } from './types'
import { categoryLabel, fetchMarketChart, fmtFull, fmtSigned } from './helpers'

function PickChart({ history, outcome, price, error, onRetry }: { history: ChartPoint[] | null; outcome: string; price: number; error: boolean; onRetry: () => void }) {
  const clipId = `expert-chart-reveal-${useId().replace(/:/g, '')}`
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)
  const points = useMemo(() => {
    if (!history || history.length < 2) return []
    const minT = history[0].t
    const spanT = Math.max(1, history[history.length - 1].t - minT)
    const prices = history.map(p => p.p)
    const minP = Math.min(...prices)
    const spanP = Math.max(0.04, Math.max(...prices) - minP)
    return history.map(p => ({ ...p, x: 6 + (p.t - minT) / spanT * 308, y: 88 - (p.p - minP) / spanP * 72 }))
  }, [history])
  const line = useMemo(() => points.map(p => `${p.x},${p.y}`).join(' '), [points])
  const endpoint = points.at(-1)
  const selected = hoverIndex === null ? null : points[Math.min(hoverIndex, points.length - 1)]
  const displayedPrice = Number(((selected?.p ?? price) * 100).toFixed(1))
  const visiblePrice = displayedPrice
  const selectedTime = selected ? new Date(selected.t * 1000).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : undefined

  return (
    <div className="expert-pick-chart">
      <div className="expert-pick-plot">
        {endpoint ? (
          <svg viewBox="0 0 320 104" role="slider" tabIndex={0}
            aria-label={`${outcome} price history. Use arrow keys to explore.`}
            aria-valuemin={0} aria-valuemax={points.length - 1} aria-valuenow={selected ? hoverIndex! : points.length - 1}
            aria-valuetext={selected ? `${selectedTime}: ${displayedPrice}%` : `${displayedPrice}% latest`}
            preserveAspectRatio="none"
            onPointerMove={event => {
              const rect = event.currentTarget.getBoundingClientRect()
              const x = (event.clientX - rect.left) / rect.width * 320
              // Binary search the nearest historical timestamp.
              let lo = 0, hi = points.length - 1
              while (lo < hi) {
                const mid = Math.floor((lo + hi) / 2)
                if (points[mid].x < x) lo = mid + 1
                else hi = mid
              }
              setHoverIndex(lo > 0 && x - points[lo - 1].x < points[lo].x - x ? lo - 1 : lo)
            }}
            onPointerLeave={() => setHoverIndex(null)}
            onPointerCancel={() => setHoverIndex(null)}
            onBlur={() => setHoverIndex(null)}
            onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(event.key)) return
              event.preventDefault()
              if (event.key === 'Escape') setHoverIndex(null)
              else if (event.key === 'Home') setHoverIndex(0)
              else if (event.key === 'End') setHoverIndex(points.length - 1)
              else setHoverIndex(index => Math.max(0, Math.min(points.length - 1, (index ?? points.length - 1) + (event.key === 'ArrowLeft' ? -1 : 1))))
            }}>
            <defs><clipPath id={clipId}><rect className="expert-pick-reveal" x="0" y="0" width="320" height="104" /></clipPath></defs>
            {[16, 52, 88].map(y => <line key={y} x1="0" x2="320" y1={y} y2={y} className="expert-pick-gridline" />)}
            <g clipPath={`url(#${clipId})`}>
              <polyline points={line} fill="none" stroke={selected ? 'var(--text-faint)' : 'currentColor'} opacity={selected ? 0.25 : 1} strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {selected && <>
              <polyline points={points.slice(0, hoverIndex! + 1).map(p => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              <line x1={selected.x} x2={selected.x} y1="8" y2="96" stroke="currentColor" strokeDasharray="2 3" />
              <circle cx={selected.x} cy={selected.y} r="4" fill="currentColor" />
            </>}
              <circle cx={endpoint.x} cy={endpoint.y} r="9" fill="currentColor" opacity="0.18" />
              <circle cx={endpoint.x} cy={endpoint.y} r="4" fill="currentColor" />
            </g>
          </svg>
        ) : history === null ? (
          <svg className="expert-pick-chart-skeleton" viewBox="0 0 320 104" aria-label="Loading price chart" role="img" preserveAspectRatio="none">
            {[16, 52, 88].map(y => <line key={y} x1="0" x2="320" y1={y} y2={y} />)}
          </svg>
        ) : <span role="status">{error ? 'Couldn’t load chart' : 'Not enough price history yet'}<button type="button" className="expert-chart-retry" onClick={onRetry}>Retry</button></span>}
      </div>
      <strong className="expert-pick-endpoint-price" style={{
        top: `${8 + (selected?.y ?? endpoint?.y ?? 52)}px`,
        ...(selected ? { left: `calc((100% - 88px) * ${selected.x / 320} + 12px)`, right: 'auto' } : {}),
      }} aria-label={`${outcome} chance: ${displayedPrice}%`}>
        {visiblePrice}<small>%</small>
      </strong>
      {selectedTime && <span className="expert-pick-hover-time">{selectedTime}</span>}
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
      <PickChart history={history} outcome={o.outcome} price={o.latest_price} error={chartError} onRetry={retry} />
      <div className="expert-pick-chart-caption"><span>Polymarket</span><span>All time</span></div>
      <div className="expert-pick-evidence">
        <div className="expert-pick-stats">
          <span title="Total invested by tracked traders"><strong>{fmtFull(o.cumulative_usd)}</strong><small>invested</small></span>
          <span title="Number of tracked expert traders"><strong><Users size={14} /> {o.wallet_count}</strong><small>{o.wallet_count === 1 ? 'expert' : 'experts'}</small></span>
          <span className={o.total_profit >= 0 ? 'g' : 'r'} title="Combined profit of tracked traders"><strong>{fmtSigned(o.total_profit)}</strong><small>tracked profit</small></span>
        </div>
      </div>
      <button className={`expert-pick-bet ${direction === 'no' ? 'is-no' : direction === 'yes' ? 'is-yes' : 'is-other'}`} onClick={onOpen} aria-label={`View expert pick: ${label} — ${o.title}`}>
        <span>Bet {label}</span><ArrowUpRight size={18} />
      </button>
    </article>
  )
}
