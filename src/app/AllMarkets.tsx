import { useState, useEffect, useRef } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import './all-markets.css'
import { supabase } from '../lib/supabase'
import { useSubscriptionGate } from '../lib/subscriptionGate'
import type { Opportunity } from './types'
import {
  onTabVisible, byCategory, opportunityCursor, PAGE_SIZE, NAV_CATEGORIES, categoryLabel, fmtFull,
} from './helpers'
import { onOpportunitiesBatch } from './realtimeBroadcast'
import { SignalModal } from './SignalModal'
import { ExpertPickCard } from './ExpertPickCard'

// The wide-angle view: every open market a tracked trader holds a position in
// (`expert_picks_open` = opportunities_live still open), filterable. Moved off
// the old Signals page; now the "All markets" tab of the Profits page, next to
// Profit Bot's strict rules-based cut of the same data. Framed as an overview,
// not a recommendation. Self-contained: owns its own category + filter state.
function AllMarkets() {
  const { locked } = useSubscriptionGate()
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  // Locked visitors never fire the live query below (see its effect) — start
  // "not loading" for them rather than flipping it off from inside an effect.
  const [loading, setLoading]             = useState(() => !locked)
  const [error, setError]                 = useState<string | null>(null)
  const [modalOpp, setModalOpp]           = useState<Opportunity | null>(null)
  const [category, setCategory]           = useState('all')
  const [filtersOpen, setFiltersOpen]     = useState(false)
  const [todayOnly, setTodayOnly]         = useState(false)
  const [sortMode, setSortMode]           = useState<'recent' | 'profit'>('profit')
  const [minWinRate, setMinWinRate]       = useState(0)
  const [minBetRatio, setMinBetRatio]     = useState(0)
  const [minPrice, setMinPrice]           = useState(0)
  const [maxPrice, setMaxPrice]           = useState(100)
  // Total slider caps at real data's ~p95 (cumulative_usd p95 ≈ $34k); the
  // field is heavily long-tailed, so the slider end means "no limit" rather
  // than a hard cap, keeping real outliers visible unless dragged off the end.
  const TOTAL_CAP = 50000
  const [minTotal, setMinTotal]           = useState(0)
  const [maxTotal, setMaxTotal]           = useState(TOTAL_CAP)
  // Anchor points + linear interpolation between them, so slider sensitivity
  // stays bounded in every segment instead of blowing up at one end (a pure
  // linear scale wastes its width on values nobody has; a pure power curve
  // made the top end unusable). Same "resolution where the data lives" goal.
  const TOTAL_ANCHORS: [number, number][] = [[0, 0], [25, 500], [50, 3000], [75, 15000], [92, 34000], [100, TOTAL_CAP]]
  const totalPos = (v: number) => {
    const val = Math.min(v, TOTAL_CAP)
    for (let i = 1; i < TOTAL_ANCHORS.length; i++) {
      const [p0, v0] = TOTAL_ANCHORS[i - 1]
      const [p1, v1] = TOTAL_ANCHORS[i]
      if (val <= v1) return p0 + ((val - v0) / (v1 - v0)) * (p1 - p0)
    }
    return 100
  }
  const totalVal = (p: number) => {
    for (let i = 1; i < TOTAL_ANCHORS.length; i++) {
      const [p0, v0] = TOTAL_ANCHORS[i - 1]
      const [p1, v1] = TOTAL_ANCHORS[i]
      if (p <= p1) return Math.round((v0 + ((p - p0) / (p1 - p0)) * (v1 - v0)) / 100) * 100
    }
    return TOTAL_CAP
  }
  const [hasMore, setHasMore]             = useState(false)
  const [loadingMore, setLoadingMore]     = useState(false)

  // Locked visitors get a small, bounded public preview (see
  // 20260911200000_all_markets_teaser.sql) instead of the live, filterable,
  // paginated feed below — expert_picks_open itself stays fully gated (this
  // is a separate ~30-row snapshot), so the paid effects below skip their
  // network calls entirely while locked.
  const [teaser, setTeaser] = useState<Opportunity[]>([])
  const [teaserLoading, setTeaserLoading] = useState(true)
  useEffect(() => {
    if (!locked) return
    let cancelled = false
    supabase.rpc('all_markets_teaser').then(({ data }) => {
      if (!cancelled) { setTeaser((data ?? []) as Opportunity[]); setTeaserLoading(false) }
    })
    return () => { cancelled = true }
  }, [locked])

  // Every discovery filter is pushed into the query itself instead of
  // filtering the already-fetched page client-side — a narrow filter (e.g.
  // 9+ traders) previously showed nothing until you'd paged deep enough to
  // stumble onto a match. Rebuilt whenever a filter changes (cheap — just
  // query-builder calls, no network) and read through a ref so the
  // mount-once effect below (which owns the Realtime subscription) always
  // uses the current filter state without needing to resubscribe on every
  // slider tick.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildQueryRef = useRef<() => any>(() => supabase.from('expert_picks_open').select('*'))
  useEffect(() => {
    buildQueryRef.current = () => {
      let q = supabase.from('expert_picks_open').select('*')
      if (category !== 'all') {
        q = category === 'other' ? q.or('category.eq.other,category.is.null') : q.eq('category', category)
      }
      if (todayOnly) {
        const startOfToday = new Date()
        startOfToday.setHours(0, 0, 0, 0)
        q = q.gte('first_seen', startOfToday.toISOString())
      }
      if (minWinRate > 0) q = q.gte('best_win_rate', minWinRate / 100)
      if (minBetRatio > 0) q = q.gte('best_bet_ratio', minBetRatio / 100)
      q = q.gte('latest_price', minPrice / 100).lte('latest_price', maxPrice / 100)
      q = q.gte('cumulative_usd', minTotal)
      if (maxTotal < TOTAL_CAP) q = q.lte('cumulative_usd', maxTotal)
      return sortMode === 'profit'
        ? q.order('total_profit', { ascending: false }).order('id', { ascending: false })
        : q.order('last_updated', { ascending: false }).order('id', { ascending: false })
    }
  }, [category, todayOnly, minWinRate, minBetRatio, minPrice, maxPrice,
      minTotal, maxTotal, sortMode])

  // How many rows are currently loaded for the active filter set — a
  // background refresh re-fetches this many instead of collapsing back to
  // one page, so "Load more" isn't silently wiped by the next poll / event.
  const loadedCountRef = useRef(PAGE_SIZE)
  const loadFirstPageRef = useRef<() => void>(() => {})

  useEffect(() => {
    // Locked visitors use the bounded teaser above instead — expert_picks_open
    // returns nothing for them anyway (still fully gated), so skip the call.
    // (loading's initial value already accounts for this — see useState below.)
    if (locked) return
    let cancelled = false
    const loadFirstPage = () => {
      loadedCountRef.current = PAGE_SIZE
      Promise.resolve(buildQueryRef.current!().limit(PAGE_SIZE))
        .then(({ data, error }) => {
          if (cancelled) return
          if (error) throw error
          const rows = (data ?? []) as Opportunity[]
          setOpportunities(rows)
          setHasMore(rows.length === PAGE_SIZE)
          setLoading(false)
          setError(null)
        })
        .catch((e: Error) => {
          if (cancelled) return
          setError(e.message)
          setLoading(false)
        })
    }
    const refreshKeepingDepth = () => {
      Promise.resolve(buildQueryRef.current!().limit(loadedCountRef.current))
        .then(({ data, error }) => {
          if (cancelled) return
          if (error) throw error
          const rows = (data ?? []) as Opportunity[]
          setOpportunities(rows)
          setHasMore(rows.length === loadedCountRef.current)
        })
        .catch(() => {})
    }
    loadFirstPageRef.current = loadFirstPage
    loadFirstPage()
    // opportunities_live is a filtered/sorted/paginated view of this page's
    // own query, so a batched change can't just be merged in place — it might
    // now belong at a different position, or no longer match the active
    // filters. live-signal-service.py already batches opportunities writes
    // into one broadcast every ~5s (BROADCAST_INTERVAL_SECONDS), so this only
    // needs one bounded refetch per batch. The interval stays as a fallback
    // in case a broadcast is ever missed (dropped connection etc.).
    const unsubBroadcast = onOpportunitiesBatch(() => {
      if (!cancelled) refreshKeepingDepth()
    }, refreshKeepingDepth)
    const interval = setInterval(refreshKeepingDepth, 60000)
    const unsubVisible = onTabVisible(refreshKeepingDepth)
    return () => {
      cancelled = true
      clearInterval(interval)
      unsubBroadcast()
      unsubVisible()
    }
  }, [locked])

  // Refetches page 1 for the new filter set whenever a filter changes —
  // debounced since range sliders fire on every drag tick. Skips the first
  // render since the mount effect above already loads page 1.
  const filterMounted = useRef(false)
  useEffect(() => {
    if (locked) return
    if (!filterMounted.current) { filterMounted.current = true; return }
    const t = setTimeout(() => loadFirstPageRef.current(), 300)
    return () => clearTimeout(t)
  }, [category, todayOnly, minWinRate, minBetRatio, minPrice, maxPrice,
      minTotal, maxTotal, sortMode, locked])

  const loadMore = () => {
    const last = opportunities[opportunities.length - 1]
    if (!last || loadingMore) return
    setLoadingMore(true)
    Promise.resolve(buildQueryRef.current!().or(opportunityCursor(last, sortMode)).limit(PAGE_SIZE))
      .then(({ data, error }) => {
        if (error) throw error
        const rows = (data ?? []) as Opportunity[]
        setOpportunities(prev => [...prev, ...rows])
        loadedCountRef.current += rows.length
        setHasMore(rows.length === PAGE_SIZE)
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false))
  }

  // Discovery filtering + the profit/recency ordering happen server-side
  // (buildQueryRef) — nothing here is excluded, this only reorders what's
  // already fetched: profit-positive first, then genuinely-uncertain
  // 10-90c prices before effectively-decided 90-100c/0-10c ones. sort is
  // stable, so sorting twice with the higher-priority key last keeps profit
  // as primary and price-bucket as secondary.
  const isDecidedPrice = (o: Opportunity) => o.latest_price >= 0.90 || o.latest_price <= 0.10
  const filteredOpportunities = [...opportunities]
    .sort((a, b) => Number(isDecidedPrice(a)) - Number(isDecidedPrice(b)))
    .sort((a, b) => Number(b.total_profit > 0) - Number(a.total_profit > 0))
  const activeFilterCount =
    (category !== 'all' ? 1 : 0) +
    (todayOnly ? 1 : 0) +
    (minWinRate > 0 ? 1 : 0) +
    (minBetRatio > 0 ? 1 : 0) +
    (minPrice > 0 || maxPrice < 100 ? 1 : 0) +
    (minTotal > 0 || maxTotal < TOTAL_CAP ? 1 : 0)

  // Locked: the bounded public teaser, filtered by category only — a fixed
  // ~30-row snapshot doesn't need the full filter/sort/pagination UI.
  const filteredTeaser = byCategory(teaser, category)

  return (
    <div className="all-markets">
      {!locked && error && (
        <div style={{ color: '#ff3b5c', padding: '0 0 20px', fontSize: '0.875rem' }}>
          Having trouble reaching market data — this usually resolves on its own. Check your internet connection if it continues.
        </div>
      )}

      <div className="sig-chips am-categories" aria-label="Market categories">
        {['all', ...NAV_CATEGORIES].map(c => (
          <button type="button" key={c} aria-pressed={category === c}
            className={category === c ? 'sig-chip active' : 'sig-chip'} onClick={() => setCategory(c)}>
            {c === 'all' ? 'All markets' : categoryLabel(c)}
          </button>
        ))}
      </div>

      {!locked && (
        <div className="sig-toolbar">
          <button
            type="button"
            className={filtersOpen ? 'sig-filters-toggle active' : 'sig-filters-toggle'}
            onClick={() => setFiltersOpen(o => !o)}
            aria-expanded={filtersOpen}
            aria-controls="am-filters"
          >
            <SlidersHorizontal size={16} /> Filters
            {activeFilterCount > 0 && <span className="sig-filters-badge">{activeFilterCount}</span>}
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className={sortMode === 'recent' ? 'sig-chip active' : 'sig-chip'} onClick={() => setSortMode('recent')}>Most recent</button>
            <button type="button" className={sortMode === 'profit' ? 'sig-chip active' : 'sig-chip'} onClick={() => setSortMode('profit')}>Most profitable</button>
          </div>
        </div>
      )}

      {!locked && filtersOpen && (
        <div className="sig-filters" id="am-filters">
          <div className="sig-filter-group">
            <button type="button"
              className={todayOnly ? 'sig-chip active' : 'sig-chip'}
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setTodayOnly(t => !t)}
            >
              Today only
            </button>
          </div>

          <div className="sig-filter-group">
            <span className="sig-filter-label">Win rate</span>
            <div className="sig-chips">
              {[0, 50, 65, 80].map(v => (
                <button type="button" key={v} className={minWinRate === v ? 'sig-chip active' : 'sig-chip'} onClick={() => setMinWinRate(v)}>
                  {v === 0 ? 'Any' : `${v}%+`}
                </button>
              ))}
            </div>
          </div>

          <div className="sig-filter-group">
            <span className="sig-filter-label">Bet vs wallet balance</span>
            <div className="sig-chips">
              {[0, 5, 15, 30].map(v => (
                <button type="button" key={v} className={minBetRatio === v ? 'sig-chip active' : 'sig-chip'} onClick={() => setMinBetRatio(v)}>
                  {v === 0 ? 'Any' : `${v}%+`}
                </button>
              ))}
            </div>
          </div>

          <div className="sig-filter-group sig-price-range">
            <span className="sig-filter-label">Price range: {minPrice}¢ – {maxPrice}¢</span>
            <div className="sig-range-track-wrap">
              <div className="sig-range-track" />
              <div className="sig-range-fill" style={{ left: `${minPrice}%`, right: `${100 - maxPrice}%` }} />
              <input
                type="range" min={0} max={100} aria-label="Minimum price in cents" value={minPrice}
                onChange={e => setMinPrice(Math.min(Number(e.target.value), maxPrice - 1))}
                className="sig-range-input"
              />
              <input
                type="range" min={0} max={100} aria-label="Maximum price in cents" value={maxPrice}
                onChange={e => setMaxPrice(Math.max(Number(e.target.value), minPrice + 1))}
                className="sig-range-input"
              />
            </div>
          </div>

          <div className="sig-filter-group sig-price-range">
            <span className="sig-filter-label">
              Total: {minTotal === 0 ? '$0' : fmtFull(minTotal)} – {maxTotal >= TOTAL_CAP ? 'no limit' : fmtFull(maxTotal)}
            </span>
            <div className="sig-range-track-wrap">
              <div className="sig-range-track" />
              <div className="sig-range-fill" style={{ left: `${totalPos(minTotal)}%`, right: `${100 - totalPos(maxTotal)}%` }} />
              <input
                type="range" min={0} max={100} step={0.5} aria-label="Minimum trade size" value={totalPos(minTotal)}
                onChange={e => setMinTotal(Math.min(totalVal(Number(e.target.value)), maxTotal - 100))}
                className="sig-range-input"
              />
              <input
                type="range" min={0} max={100} step={0.5} aria-label="Maximum trade size" value={totalPos(maxTotal)}
                onChange={e => setMaxTotal(Math.max(totalVal(Number(e.target.value)), minTotal + 100))}
                className="sig-range-input"
              />
            </div>
          </div>
        </div>
      )}

      {locked ? (
        <div className="expert-picks-grid" aria-busy={teaserLoading}>
          {teaserLoading && Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="expert-pick-skeleton" aria-label="Loading pick" />
          ))}
          {!teaserLoading && filteredTeaser.length === 0 && (
            <div className="sig-empty">No markets match right now. Try adjusting your filters or check back soon.</div>
          )}
          {!teaserLoading && filteredTeaser.map(o => (
            <ExpertPickCard key={`${o.condition_id}::${o.outcome}`} opportunity={o} onOpen={() => setModalOpp(o)} />
          ))}
        </div>
      ) : (
        <>
          <div className="expert-picks-grid" aria-busy={loading}>
            {loading && Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="expert-pick-skeleton" aria-label="Loading pick" />
            ))}
            {!loading && filteredOpportunities.length === 0 && (
              <div className="sig-empty">No markets match right now. Try adjusting your filters or check back soon.</div>
            )}
            {!loading && filteredOpportunities.map(o => (
              <ExpertPickCard key={`${o.condition_id}::${o.outcome}`} opportunity={o} onOpen={() => setModalOpp(o)} />
            ))}
          </div>
          {!loading && hasMore && (
            <button className="sig-load-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}

      <div className="sig-foot">Every open market tracked traders hold — an overview, not a recommendation</div>

      {modalOpp && (
        <SignalModal
          key={`${modalOpp.condition_id}::${modalOpp.outcome}`}
          opportunity={modalOpp}
          onClose={() => setModalOpp(null)}
        />
      )}
    </div>
  )
}

export default AllMarkets
