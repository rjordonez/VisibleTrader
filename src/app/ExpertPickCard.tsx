import { MarketIcon } from './MarketIcon'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Lock, Users } from 'lucide-react'
import { dashboardPath } from '../lib/domains'
import { useSubscriptionGate } from '../lib/subscriptionGate'
import type { ChartPoint, Opportunity } from './types'
import { categoryLabel, fetchMarketChart, fmtFull } from './helpers'
import { PickChart } from './PickChart'
import './expert-pick-card.css'

export function ExpertPickCard({ opportunity: o, onOpen }: { opportunity: Opportunity; onOpen: () => void }) {
  const { locked } = useSubscriptionGate()
  const container = useRef<HTMLElement>(null)
  const [history, setHistory] = useState<ChartPoint[] | null>(null)

  const [chartError, setChartError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const retry = () => { setHistory(null); setChartError(false); setAttempt(value => value + 1) }

  const [image, setImage] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    // Only request history as a card approaches the viewport. Runs the
    // same whether locked or not now — price-chart no longer requires a
    // subscription (it's Polymarket's own public price data; what stays
    // gated is which markets the tracked roster is even on).
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
  const winRatePct = o.best_win_rate != null ? Math.round(o.best_win_rate * 100) : null

  return (
    <article ref={container} className={`expert-pick-card ${locked ? 'is-locked' : ''}`}>
      <div className="expert-pick-topline">
        <span>{categoryLabel(o.category ?? 'other')}</span>
        {/* Suppressed when locked so there's nowhere to bounce off-platform
            to Polymarket before subscribing — the market itself is visible
            (title, chart), it's which side to bet that's gated below. */}
        {!locked && (
          <a href={`https://polymarket.com/event/${encodeURIComponent(o.event_slug || o.slug)}`} target="_blank" rel="noopener noreferrer">
            View market <ArrowUpRight size={14} />
          </a>
        )}
      </div>
      {locked ? (
        <Link to={dashboardPath('/pricing')} className="expert-pick-title">
          <MarketIcon conditionId={o.condition_id} outcome={o.outcome} category={o.category} className="expert-pick-icon" source={image} />
          <h3>{o.title}</h3>
        </Link>
      ) : (
        <button className="expert-pick-title" onClick={onOpen}>
          <MarketIcon conditionId={o.condition_id} outcome={o.outcome} category={o.category} className="expert-pick-icon" source={image} />
          <h3>{o.title}</h3>
        </button>
      )}
      {/* Locked: shown but blurred + non-interactive — proof a real,
          tracked chart exists without giving away the shape of the move. */}
      <div className={locked ? 'expert-pick-chart-locked' : undefined}>
        <PickChart history={history} outcome={o.outcome} price={o.latest_price} error={chartError} onRetry={retry} />
      </div>
      <div className="expert-pick-chart-caption"><span>Polymarket</span><span>All time</span></div>
      <div className="expert-pick-evidence">
        <div className="expert-pick-stats">
          {winRatePct != null && (
            <span title="Best win rate among the tracked traders backing this pick"><strong>{winRatePct}%</strong><small>top trader win rate</small></span>
          )}
          <span title="Total invested by tracked traders"><strong>{fmtFull(o.cumulative_usd)}</strong><small>invested</small></span>
          <span title="Number of tracked expert traders"><strong><Users size={14} /> {o.wallet_count}</strong><small>{o.wallet_count === 1 ? 'expert' : 'experts'}</small></span>
        </div>
      </div>
      {locked ? (
        <Link to={dashboardPath('/pricing')} className="expert-pick-bet is-locked">
          <Lock size={15} /><span>Subscribe to see this pick</span>
        </Link>
      ) : (
        <button className={`expert-pick-bet ${direction === 'no' ? 'is-no' : direction === 'yes' ? 'is-yes' : 'is-other'}`} onClick={onOpen} aria-label={`View expert pick: ${label} — ${o.title}`}>
          <span>Bet {label}</span><ArrowUpRight size={18} />
        </button>
      )}
    </article>
  )
}
