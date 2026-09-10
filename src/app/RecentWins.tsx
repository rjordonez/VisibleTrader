import { useState, useEffect, useRef } from 'react'
import { SlidersHorizontal, ArrowUpRight, Trophy } from 'lucide-react'
import './recent-wins.css'
import { supabase } from '../lib/supabase'
import type { WalletPosition } from './types'
import {
  onTabVisible, NAV_CATEGORIES, categoryLabel, fmtFull, fmtSigned,
  profileUrl, traderLabel, timeAgo, avatarGradient, avatarInitial,
} from './helpers'
import GogglesMark from './GogglesMark'
import { SkelLbRow } from './Skeleton'

// Closed, profitable positions from tracked wallets — a recent-wins carousel
// plus the deep feed. Moved off the old Signals page; now the "Recent wins"
// tab of the Leaderboard page. Self-contained: owns its own category + filter
// state. Only mounted while its tab is active, so nothing here fetches until
// the user opens it.
function RecentWins() {
  const [wins, setWins]               = useState<WalletPosition[]>([])
  const [winsLoading, setWinsLoading] = useState(true)
  const [category, setCategory]       = useState('all')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [todayOnly, setTodayOnly]     = useState(false)
  const [minWinRate, setMinWinRate]   = useState(0)
  const [minBetRatio, setMinBetRatio] = useState(0)
  const [minPrice, setMinPrice]       = useState(0)
  const [maxPrice, setMaxPrice]       = useState(100)
  // Total slider caps at real data's ~p95; the field is heavily long-tailed,
  // so the slider end means "no limit" rather than a hard cap.
  const TOTAL_CAP = 50000
  const [minTotal, setMinTotal]       = useState(0)
  const [maxTotal, setMaxTotal]       = useState(TOTAL_CAP)
  // Anchor points + linear interpolation between them, so slider sensitivity
  // stays bounded in every segment instead of blowing up at one end.
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
  const [winRateMap, setWinRateMap]   = useState<Map<string, number>>(new Map())
  const [balanceMap, setBalanceMap]   = useState<Map<string, number>>(new Map())

  // Category/Today/Price/Total are pushed into the query itself, not filtered
  // client-side afterward — Winners contains rare, large-value events, so
  // filtering an already-fetched "200 most recent" window for e.g. a $9k+
  // minimum could leave almost nothing even though plenty of matching rows
  // exist further back in history. Win rate / Bet ratio still can't be pushed
  // server-side (they need a join against leaderboard / wallet_balances that
  // wallet_positions doesn't have), so those stay as client-side post-filters
  // in filteredWins below.
  //
  // A close is an UPDATE on opportunity_wallets, not an INSERT. This feed used
  // to hold a Realtime subscription on that table to trigger a refetch, but an
  // unfiltered postgres_changes UPDATE sub on opportunity_wallets (~1.6M rows,
  // written continuously by live-signal-service.py) is exactly the per-row
  // fanout that blew the Realtime message quota in Sept 2026 (see
  // realtimeBroadcast.ts). Closed profitable positions are rare, high-value
  // events, so a plain poll plus a refetch on tab-focus keeps this current
  // without any Realtime load.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildWinsQueryRef = useRef<() => any>(() => supabase.from('wallet_positions').select('*'))
  useEffect(() => {
    buildWinsQueryRef.current = () => {
      // Filters on closed_profit (a real generated/indexed column), not the
      // general-purpose profit column — equivalent for this feed since it
      // only ever shows closed positions anyway.
      let q = supabase.from('wallet_positions').select('*')
        .not('closed_at', 'is', null)
        .gt('closed_profit', 0)
        // 100 = the dust floor (filters sub-$100 multi-leg remainders) —
        // Math.max so a lower minTotal never re-opens that gap.
        .gte('usd', Math.max(100, minTotal))
      if (maxTotal < TOTAL_CAP) q = q.lte('usd', maxTotal)
      q = q.gte('price', minPrice / 100).lte('price', maxPrice / 100)
      if (category !== 'all') {
        q = category === 'other' ? q.or('category.eq.other,category.is.null') : q.eq('category', category)
      }
      if (todayOnly) {
        const startOfToday = new Date()
        startOfToday.setHours(0, 0, 0, 0)
        q = q.gte('closed_at', startOfToday.toISOString())
      }
      return q.order('closed_at', { ascending: false }).limit(200)
    }
  }, [category, todayOnly, minPrice, maxPrice, minTotal, maxTotal, TOTAL_CAP])

  const loadWinsRef = useRef<() => void>(() => {})
  useEffect(() => {
    let cancelled = false
    const load = () => {
      Promise.resolve(buildWinsQueryRef.current!())
        .then(({ data }) => {
          if (cancelled) return
          setWins((data ?? []) as WalletPosition[])
          setWinsLoading(false)
        })
        .catch(() => { if (!cancelled) setWinsLoading(false) })
    }
    loadWinsRef.current = load
    load()
    const interval = setInterval(load, 30000)
    const unsubVisible = onTabVisible(load)
    return () => { cancelled = true; clearInterval(interval); unsubVisible() }
  }, [])

  // Refetches for the new filter set whenever a filter changes — debounced
  // since range sliders fire on every drag tick. Skips the first render
  // since the mount effect above already loads once.
  const winsFilterMounted = useRef(false)
  useEffect(() => {
    if (!winsFilterMounted.current) { winsFilterMounted.current = true; return }
    const t = setTimeout(() => loadWinsRef.current(), 300)
    return () => clearTimeout(t)
  }, [category, todayOnly, minPrice, maxPrice, minTotal, maxTotal])

  // Win rate / wallet-balance data for the two threshold filters — both
  // change slowly (win rate only moves on resolution, balance only on the
  // ~15min backend refresh), so this polls less often than the wins feed.
  useEffect(() => {
    let cancelled = false
    const load = () => {
      Promise.all([
        Promise.resolve(supabase.from('leaderboard').select('wallet, won, lost')),
        Promise.resolve(supabase.from('wallet_balances').select('wallet, usdc_balance')),
      ]).then(([lb, wb]) => {
        if (cancelled) return
        const wr = new Map<string, number>()
        for (const r of (lb.data ?? []) as { wallet: string; won: number; lost: number }[]) {
          const total = r.won + r.lost
          if (total > 0) wr.set(r.wallet, r.won / total)
        }
        setWinRateMap(wr)
        const bal = new Map<string, number>()
        for (const r of (wb.data ?? []) as { wallet: string; usdc_balance: number | null }[]) {
          if (r.usdc_balance != null && r.usdc_balance > 0) bal.set(r.wallet, r.usdc_balance)
        }
        setBalanceMap(bal)
      }).catch(() => {})
    }
    load()
    const interval = setInterval(load, 60000)
    const unsubVisible = onTabVisible(load)
    return () => { cancelled = true; clearInterval(interval); unsubVisible() }
  }, [])

  // category/todayOnly/price/total are already applied server-side in
  // buildWinsQueryRef — only Win rate / Bet ratio need to stay client-side.
  const filteredWins = wins
    .filter(w => {
      if (minWinRate === 0) return true
      const wr = winRateMap.get(w.wallet)
      return wr !== undefined && wr * 100 >= minWinRate
    })
    .filter(w => {
      if (minBetRatio === 0) return true
      const bal = balanceMap.get(w.wallet)
      return bal !== undefined && bal > 0 && (w.usd / bal) * 100 >= minBetRatio
    })
  // Multi-leg fills (a single logical position built/closed across several
  // on-chain legs) show up as several rows for the same wallet+market+outcome
  // — fold those together into one row (summed stake + profit). Grouped by
  // key rather than "merge if adjacent": when a market resolves, a single
  // wallet's own entries can land non-adjacent within the tied resolved_ts
  // cluster. Map preserves first-seen order = the most recent occurrence,
  // since filteredWins is already sorted desc.
  const mergedWinsMap = new Map<string, WalletPosition>()
  for (const w of filteredWins) {
    const gkey = `${w.wallet}::${w.condition_id}::${w.outcome}`
    const existing = mergedWinsMap.get(gkey)
    if (existing) {
      existing.usd += w.usd
      existing.profit += w.profit
    } else {
      mergedWinsMap.set(gkey, { ...w })
    }
  }
  const mergedWins = Array.from(mergedWinsMap.values())

  const activeFilterCount =
    (category !== 'all' ? 1 : 0) +
    (todayOnly ? 1 : 0) +
    (minWinRate > 0 ? 1 : 0) +
    (minBetRatio > 0 ? 1 : 0) +
    (minPrice > 0 || maxPrice < 100 ? 1 : 0) +
    (minTotal > 0 || maxTotal < TOTAL_CAP ? 1 : 0)

  return (
    <div className="recent-wins">
      {(winsLoading || mergedWins.length > 0) && (
        <section className="rw-highlights" aria-labelledby="rw-highlights-title">
          <div className="rw-highlights-heading">
            <h2 id="rw-highlights-title"><Trophy size={17} /> Recent wins</h2>
          </div>
          <div className="rw-highlights-track" aria-busy={winsLoading}>
            {winsLoading ? Array.from({ length: 4 }, (_, i) => (
              <div key={i} className="rw-win-card rw-win-skeleton" aria-hidden="true" />
            )) : mergedWins.slice(0, 8).map(w => (
              <a className="rw-win-card" key={`${w.wallet}:${w.condition_id}:${w.outcome}`}
                href={profileUrl(w.wallet)!} target="_blank" rel="noopener noreferrer">
                <div className="rw-win-trader">
                  <span className="rw-win-avatar" style={{ background: avatarGradient(w.wallet) }}>{avatarInitial(w.wallet, w.wallet_name)}</span>
                  <span>{traderLabel(w.wallet, w.wallet_name)}</span>
                  <ArrowUpRight size={14} />
                </div>
                <div className="rw-win-profit">{fmtSigned(w.profit)}</div>
                <div className="rw-win-market" title={`${w.title} — ${w.outcome}`}>{w.title} — {w.outcome}</div>
              </a>
            ))}
          </div>
        </section>
      )}

      <div className="sig-chips rw-categories" aria-label="Market categories">
        {['all', ...NAV_CATEGORIES].map(c => (
          <button type="button" key={c} aria-pressed={category === c}
            className={category === c ? 'sig-chip active' : 'sig-chip'} onClick={() => setCategory(c)}>
            {c === 'all' ? 'All markets' : categoryLabel(c)}
          </button>
        ))}
      </div>

      <div className="sig-toolbar">
        <button
          type="button"
          className={filtersOpen ? 'sig-filters-toggle active' : 'sig-filters-toggle'}
          onClick={() => setFiltersOpen(o => !o)}
          aria-expanded={filtersOpen}
          aria-controls="rw-filters"
        >
          <SlidersHorizontal size={16} /> Filters
          {activeFilterCount > 0 && <span className="sig-filters-badge">{activeFilterCount}</span>}
        </button>
      </div>

      {filtersOpen && (
        <div className="sig-filters" id="rw-filters">
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

      <div className="lb-table">
        <div className="lb-head lb-4col">
          <div>Trader</div>
          <div>Market</div>
          <div className="lb-col">PnL</div>
          <div className="lb-col">Staked</div>
        </div>
        {winsLoading && Array.from({ length: 8 }).map((_, i) => <SkelLbRow key={i} />)}
        {!winsLoading && mergedWins.length === 0 && (
          <div className="sig-empty">Waiting for the next win…</div>
        )}
        {!winsLoading && mergedWins.map(w => {
          const key = `${w.wallet}::${w.condition_id}::${w.outcome}::${w.closed_at}`
          const roi = w.usd > 0 ? (w.profit / w.usd) * 100 : 0
          return (
            <div key={key} className="lb-row lb-4col">
              <div className="lb-trader">
                <div className="lb-avatar" style={{ background: avatarGradient(w.wallet) }}><GogglesMark /></div>
                <div style={{ minWidth: 0 }}>
                  <a href={profileUrl(w.wallet)!} target="_blank" rel="noopener noreferrer" className="lb-name">
                    {traderLabel(w.wallet, w.wallet_name)}
                  </a>
                  <div className="lb-sub">
                    {w.is_scalp ? 'Scalped' : w.market_closed ? 'Won' : 'Exited'} · {timeAgo(w.closed_at)}
                  </div>
                </div>
              </div>

              <div className="lb-market">
                <div className="sig-q">{w.title} <span className="sig-out">— {w.outcome}</span></div>
              </div>

              <div className="lb-stats">
                <div className="lb-col" data-label="PnL">
                  <div className="lb-col-stack">
                    <div className="lb-val g">{fmtSigned(w.profit)}</div>
                    <div className="lb-val-sub" style={{ color: 'var(--green)' }}>▲ {roi.toFixed(1)}%</div>
                  </div>
                </div>

                <div className="lb-col" data-label="Staked">
                  <div className="lb-col-stack">
                    <div className="lb-val">{fmtFull(w.usd)}</div>
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="sig-foot">Closed, profitable positions from tracked wallets · not a recommendation</div>
    </div>
  )
}

export default RecentWins
