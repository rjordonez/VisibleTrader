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
    // Only request history as a card approaches the viewport. Runs even
    // when locked — the market icon is free for everyone (price-chart's
    // slug/image lookup no longer requires a subscription); only the
    // price history it also returns comes back empty for a locked caller,
    // which is fine since <PickChart> isn't rendered in that case anyway.
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
        {/* The market link identifies exactly which pick this is — that's
            the thing being gated, so it drops out entirely once the title
            below is blurred, instead of leaking the answer around it. */}
        {!locked && (
          <a href={`https://polymarket.com/event/${encodeURIComponent(o.event_slug || o.slug)}`} target="_blank" rel="noopener noreferrer">
            View market <ArrowUpRight size={14} />
          </a>
        )}
      </div>
      {locked ? (
        <Link to={dashboardPath('/pricing')} className="expert-pick-title">
          <MarketIcon conditionId={o.condition_id} outcome={o.outcome} category={o.category} className="expert-pick-icon" source={image} />
          <h3 className="expert-pick-title-blur" aria-hidden="true">{o.title}</h3>
          <span className="sr-only">Subscribe to see this pick: {o.title}</span>
        </Link>
      ) : (
        <button className="expert-pick-title" onClick={onOpen}>
          <MarketIcon conditionId={o.condition_id} outcome={o.outcome} category={o.category} className="expert-pick-icon" source={image} />
          <h3>{o.title}</h3>
        </button>
      )}
      {!locked && (
        <>
          <PickChart history={history} outcome={o.outcome} price={o.latest_price} error={chartError} onRetry={retry} />
          <div className="expert-pick-chart-caption"><span>Polymarket</span><span>All time</span></div>
        </>
      )}
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
