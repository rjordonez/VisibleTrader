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

// Shown while a market opened by direct link is being fetched (it wasn't in
// the sidebar's top-PAGE_SIZE window). Mirrors the real two-column market
// layout below so the panel doesn't jump when the data lands, instead of a
// big centered "Loading…".
function MarketViewSkeleton() {
  return (
    <div className="terminal-market" aria-busy="true" aria-label="Loading market">
      <div className="terminal-market-main">
        <div className="sig-hero-top">
          <div className="sig-skel" style={{ width: 44, height: 44, borderRadius: 10, flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sig-skel" style={{ height: 20, width: '70%', borderRadius: 5, marginBottom: 10 }} />
            <div className="sig-skel" style={{ height: 12, width: '40%', borderRadius: 5 }} />
          </div>
        </div>
        <div className="sig-stats-row" style={{ margin: '16px 0' }}>
          {[0, 1, 2, 3].map(i => (
            <div className="sig-stat-cell" key={i}>
              <div className="sig-skel" style={{ height: 10, width: 60, marginBottom: 10 }} />
              <div className="sig-skel" style={{ height: 20, width: 84 }} />
            </div>
          ))}
        </div>
        <div className="sig-skel" style={{ height: 11, width: 90, borderRadius: 4, marginBottom: 12 }} />
        <div className="sig-skel" style={{ height: 300, borderRadius: 12, marginBottom: 20 }} />
        <div style={{ display: 'grid', gap: 8 }}>
          {[0, 1, 2, 3, 4].map(i => <div key={i} className="sig-skel" style={{ height: 40, borderRadius: 8 }} />)}
        </div>
      </div>
      <div className="terminal-market-side">
        <div className="sig-skel" style={{ height: 320, borderRadius: 14 }} />
      </div>
    </div>
  )
}

export default function TerminalMarketView({ opportunities }: { opportunities: Opportunity[] }) {
  const { conditionId, outcome } = useParams<{ conditionId: string; outcome: string }>()
  const [fallback, setFallback] = useState<Opportunity | null>(null)
  // Whether the direct-lookup below has actually run to completion. Starts
  // false so the very first render (before the effect fires) shows the
  // skeleton, not a "Market not found" flash.
  const [fallbackDone, setFallbackDone] = useState(false)

  const cached = opportunities.find(o => o.condition_id === conditionId && o.outcome === outcome) ?? null

  // The sidebar only holds the top PAGE_SIZE markets by conviction — a
  // direct link to a market outside that window (e.g. shared, bookmarked,
  // or just further down the list) wouldn't resolve without this fallback.
  useEffect(() => {
    if (cached || !conditionId || !outcome) { setFallback(null); setFallbackDone(true); return }
    let cancelled = false
    setFallbackDone(false)
    Promise.resolve(
      supabase.from('opportunities_live').select('*')
        .eq('condition_id', conditionId).eq('outcome', outcome)
        .maybeSingle()
    ).then(({ data }) => {
      if (!cancelled) setFallback((data as Opportunity | null) ?? null)
    }).finally(() => {
      if (!cancelled) setFallbackDone(true)
    })
    return () => { cancelled = true }
  }, [cached, conditionId, outcome])

  const opportunity = cached ?? fallback

  if (!opportunity) {
    // Only call it "not found" once the lookup has finished — until then
    // (including the first render, before the effect runs) show the skeleton.
    if (!fallbackDone) return <MarketViewSkeleton />
    return (
      <div className="terminal-empty terminal-card">
        <div className="terminal-empty-title">Market not found</div>
        <div className="terminal-empty-sub">This market isn't in the tracked-wallet dataset (or the link is stale).</div>
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
          chartHeight={300}
          priceUnit="%"
          chartVariant="minimal"
        />
      </div>
      <div className="terminal-market-side">
        <AboutMarketPanel opportunity={opportunity} />
      </div>
    </div>
  )
}
