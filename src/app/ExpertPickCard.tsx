import { MarketIcon } from './MarketIcon'
import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Users } from 'lucide-react'
import type { ChartPoint, Opportunity } from './types'
import { categoryLabel, fetchMarketChart, fmtFull, fmtSigned } from './helpers'
import { PickChart } from './PickChart'
import './expert-pick-card.css'

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
