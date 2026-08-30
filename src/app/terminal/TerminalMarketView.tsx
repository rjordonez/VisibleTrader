import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import type { Opportunity, ChartPoint } from '../types'
import { marketUrl, fetchChart } from '../helpers'
import { terminalPath } from '../../lib/domains'
import { MarketDetailContent } from '../MarketDetailContent'

function fmtSignedPct(n: number) {
  return (n >= 0 ? '+' : '-') + Math.abs(n).toFixed(1) + '%'
}

// Timeframe price-change tiles (5M/1H/4H/1D), computed client-side from the
// same chart history the price chart already fetches — no new query. Finds
// the closest point at or before "now minus window" and diffs against the
// latest point.
function useTimeframeChanges(history: ChartPoint[]) {
  return useMemo(() => {
    if (history.length < 2) return null
    const latest = history[history.length - 1]
    const windows: { label: string; seconds: number }[] = [
      { label: '5M', seconds: 5 * 60 },
      { label: '1H', seconds: 60 * 60 },
      { label: '4H', seconds: 4 * 60 * 60 },
      { label: '1D', seconds: 24 * 60 * 60 },
    ]
    return windows.map(({ label, seconds }) => {
      const targetT = latest.t - seconds
      // History is chronological — walk from the end to find the last point
      // at or before the target time (falls back to the earliest point for
      // windows longer than the market's own history).
      let ref = history[0]
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].t <= targetT) { ref = history[i]; break }
      }
      const change = ref.p > 0 ? ((latest.p - ref.p) / ref.p) * 100 : 0
      return { label, change }
    })
  }, [history])
}

function AboutMarketPanel({ opportunity }: { opportunity: Opportunity }) {
  const [chartHistory, setChartHistory] = useState<ChartPoint[]>([])

  useEffect(() => {
    let cancelled = false
    fetchChart(opportunity.condition_id, opportunity.outcome).then(h => { if (!cancelled) setChartHistory(h) })
    return () => { cancelled = true }
  }, [opportunity.condition_id, opportunity.outcome])

  const timeframes = useTimeframeChanges(chartHistory)
  const url = marketUrl(opportunity.slug)

  return (
    <div className="terminal-about terminal-card">
      <div className="terminal-about-label">About this market</div>
      <div className="terminal-about-row">
        <span className="terminal-about-key">Category</span>
        <span className="terminal-about-val">{opportunity.category ?? 'Other'}</span>
      </div>
      <div className="terminal-about-row">
        <span className="terminal-about-key">Tracked wallets</span>
        <span className="terminal-about-val">{opportunity.wallet_count}</span>
      </div>

      {timeframes && (
        <div className="terminal-timeframes">
          {timeframes.map(t => (
            <div key={t.label} className="terminal-timeframe-tile">
              <div className="terminal-timeframe-label">{t.label}</div>
              <div className={`terminal-timeframe-val ${t.change >= 0 ? 'g' : 'r'}`}>
                {fmtSignedPct(t.change)}
              </div>
            </div>
          ))}
        </div>
      )}

      {url && (
        <a href={url} target="_blank" rel="noopener noreferrer" className="terminal-about-link">
          View on Polymarket ↗
        </a>
      )}

      <p className="terminal-about-disclaimer">
        VisibleTrader only tracks public, on-chain activity — it never executes trades. Want to be notified the
        moment a tracked wallet moves in a market like this? <a href="/alerts">Set up alerts</a>.
      </p>
    </div>
  )
}

export default function TerminalMarketView({ opportunities }: { opportunities: Opportunity[] }) {
  const { conditionId, outcome } = useParams<{ conditionId: string; outcome: string }>()
  const [fallback, setFallback] = useState<Opportunity | null>(null)
  const [fallbackLoading, setFallbackLoading] = useState(false)

  const cached = opportunities.find(o => o.condition_id === conditionId && o.outcome === outcome) ?? null

  // The sidebar only holds the top PAGE_SIZE markets by conviction — a
  // direct link to a market outside that window (e.g. shared, bookmarked,
  // or just further down the list) wouldn't resolve without this fallback.
  useEffect(() => {
    if (cached || !conditionId || !outcome) { setFallback(null); return }
    let cancelled = false
    setFallbackLoading(true)
    Promise.resolve(
      supabase.from('opportunities_live').select('*')
        .eq('condition_id', conditionId).eq('outcome', outcome)
        .maybeSingle()
    ).then(({ data }) => {
      if (!cancelled) setFallback((data as Opportunity | null) ?? null)
    }).finally(() => {
      if (!cancelled) setFallbackLoading(false)
    })
    return () => { cancelled = true }
  }, [cached, conditionId, outcome])

  const opportunity = cached ?? fallback

  if (!opportunity) {
    return (
      <div className="terminal-empty terminal-card">
        <div className="terminal-empty-title">{fallbackLoading ? 'Loading…' : 'Market not found'}</div>
        {!fallbackLoading && (
          <div className="terminal-empty-sub">This market isn't in the tracked-wallet dataset (or the link is stale).</div>
        )}
      </div>
    )
  }

  return (
    <div className="terminal-market">
      <div className="terminal-market-main">
        <MarketDetailContent
          key={`${opportunity.condition_id}::${opportunity.outcome}`}
          opportunity={opportunity}
          linkToTrader={w => terminalPath(`/trader/${w}`)}
          chartHeight={400}
        />
      </div>
      <div className="terminal-market-side">
        <AboutMarketPanel opportunity={opportunity} />
      </div>
    </div>
  )
}
