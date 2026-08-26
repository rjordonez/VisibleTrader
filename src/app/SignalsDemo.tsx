import { useState, useEffect, useRef } from 'react'
import { ExternalLink, Star } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Opportunity, TickerTrade, WalletPosition } from './types'
import {
  onTabVisible, byCategory, opportunityCursor, PAGE_SIZE,
  categoryIcon, categoryLabel, gaugePct, gaugeColor, signalsTag, fmtFull, fmtSigned, isToday,
  profileUrl, traderLabel, timeAgo, marketUrl, avatarGradient, avatarInitial,
} from './helpers'
import { SignalModal } from './SignalModal'
import { SkelCard, SkelLbRow } from './Skeleton'

function SignalsDemo({ category }: { category: string }) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState<string | null>(null)
  const [modalOpp, setModalOpp]           = useState<Opportunity | null>(null)
  const [ticker, setTicker]               = useState<TickerTrade[]>([])
  const [tickerLoading, setTickerLoading] = useState(true)
  const [wins, setWins]                   = useState<WalletPosition[]>([])
  const [winsLoading, setWinsLoading]     = useState(true)
  const [tab, setTab]                     = useState<'ticker' | 'wins' | 'vetted' | 'tracked'>('ticker')
  const [userId, setUserId]               = useState<string | null>(null)
  const [trackedPicks, setTrackedPicks]   = useState<Set<string>>(new Set())
  const [trackBusy, setTrackBusy]         = useState<string | null>(null)
  const [todayOnly, setTodayOnly]         = useState(false)
  const [sortMode, setSortMode]           = useState<'recent' | 'profit'>('recent')
  const [minWinRate, setMinWinRate]       = useState(0)
  const [minBetRatio, setMinBetRatio]     = useState(0)
  const [minPrice, setMinPrice]           = useState(0)
  const [maxPrice, setMaxPrice]           = useState(100)
  // Total/Won sliders cap at real data's ~p95 (checked live: cumulative_usd
  // p95 ≈ $34k, total_profit p5/p95 ≈ -$6.8k/+$8.3k) — both fields are
  // heavily long-tailed, so the slider ends mean "no limit" rather than a
  // hard cap, keeping real outliers visible unless the user actually drags
  // off the end.
  const TOTAL_CAP = 50000
  const WON_FLOOR = -10000
  const WON_CAP = 10000
  const [minTotal, setMinTotal]           = useState(0)
  const [maxTotal, setMaxTotal]           = useState(TOTAL_CAP)
  // Total is heavily long-tailed (p95 ≈ $34k out of a $50k cap), so a linear
  // slider wastes almost all its draggable width on values nobody has — most
  // real stakes/volumes sit in the low hundreds/thousands. A pure sqrt/power
  // curve fixed the low end but made the top end nearly unusable (each pixel
  // there jumped the value by thousands, so dragging near the max handle hit
  // the min<max-$100 clamp almost instantly and then looked frozen). Anchor
  // points + linear interpolation between them instead — same "most
  // resolution where the data lives" goal, but sensitivity stays bounded in
  // every segment instead of blowing up at one end.
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
  const [minWon, setMinWon]               = useState(WON_FLOOR)
  const [maxWon, setMaxWon]               = useState(WON_CAP)
  // wallet_count checked live: 1-16 actual range, p95=7 — small and bounded
  // enough that a plain 1-20 cap needs no "unlimited" sentinel like
  // Total/Won do.
  const TRADERS_CAP = 20
  const [minTraders, setMinTraders]       = useState(1)
  const [maxTraders, setMaxTraders]       = useState(TRADERS_CAP)
  const [winRateMap, setWinRateMap]       = useState<Map<string, number>>(new Map())
  const [balanceMap, setBalanceMap]       = useState<Map<string, number>>(new Map())
  const [hasMore, setHasMore]             = useState(false)
  const [loadingMore, setLoadingMore]     = useState(false)

  // Every discovery filter is pushed into the query itself instead of
  // filtering the already-fetched page client-side — a narrow filter (e.g.
  // 9+ traders) previously showed nothing until you'd paged deep enough to
  // stumble onto a match, since it only ever searched whatever was already
  // in the browser. Rebuilt whenever a filter changes (cheap — just
  // query-builder calls, no network) and read through a ref so the
  // mount-once effect below (which owns the Realtime subscription) always
  // uses the current filter state without needing to tear down and
  // resubscribe on every slider tick.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildQueryRef = useRef<() => any>(() => supabase.from('opportunities_live').select('*'))
  useEffect(() => {
    buildQueryRef.current = () => {
      let q = supabase.from('opportunities_live').select('*')
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
      if (minWon > WON_FLOOR) q = q.gte('total_profit', minWon)
      if (maxWon < WON_CAP) q = q.lte('total_profit', maxWon)
      q = q.gte('wallet_count', minTraders)
      if (maxTraders < TRADERS_CAP) q = q.lte('wallet_count', maxTraders)
      return sortMode === 'profit'
        ? q.order('total_profit', { ascending: false }).order('id', { ascending: false })
        : q.order('last_updated', { ascending: false }).order('id', { ascending: false })
    }
  }, [category, todayOnly, minWinRate, minBetRatio, minPrice, maxPrice,
      minTotal, maxTotal, minWon, maxWon, minTraders, maxTraders, sortMode, WON_FLOOR])

  // How many rows are currently loaded for the active filter set — a
  // background refresh re-fetches this many instead of collapsing back to
  // one page, so "Load more" doesn't get silently wiped out from under you
  // by the next 5s poll or Realtime event.
  const loadedCountRef = useRef(PAGE_SIZE)
  const loadFirstPageRef = useRef<() => void>(() => {})

  useEffect(() => {
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
    // opportunities_live is a view, so Realtime (which taps Postgres's
    // replication stream on real tables) can't subscribe to it directly —
    // instead, listen for changes on `opportunities` and re-fetch once one
    // fires. Only `opportunities` needs watching: live-signal-service.py
    // now writes opportunity_stats under the same lock as every
    // opportunity_wallets write, and every one of those paths also touches
    // `opportunities` (latest_price, last_updated, or is_current), so a
    // wallet-level change is never invisible here. Mark-to-market price
    // ticks land on `opportunities` continuously across ~1,400 tracked
    // markets, so this debounces (trailing-edge) rather than firing on
    // every single event. The interval stays as a fallback in case a
    // realtime event is ever missed (dropped connection etc.).
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const debouncedRefresh = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(refreshKeepingDepth, 1000)
    }
    const channel = supabase
      .channel('opportunities-live-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'opportunities' }, debouncedRefresh)
      .subscribe()
    const interval = setInterval(refreshKeepingDepth, 60000)
    const unsubVisible = onTabVisible(refreshKeepingDepth)
    return () => {
      cancelled = true
      clearInterval(interval)
      if (debounceTimer) clearTimeout(debounceTimer)
      supabase.removeChannel(channel)
      unsubVisible()
    }
  }, [])

  // Refetches page 1 for the new filter set whenever a filter changes —
  // debounced since range sliders fire on every drag tick. Skips the very
  // first render since the mount effect above already loads page 1.
  const filterMounted = useRef(false)
  useEffect(() => {
    if (!filterMounted.current) { filterMounted.current = true; return }
    const t = setTimeout(() => loadFirstPageRef.current(), 300)
    return () => clearTimeout(t)
  }, [category, todayOnly, minWinRate, minBetRatio, minPrice, maxPrice,
      minTotal, maxTotal, minWon, maxWon, minTraders, maxTraders, sortMode])

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

  useEffect(() => {
    let cancelled = false
    const load = () => {
      Promise.resolve(supabase.from('ticker').select('*').order('epoch', { ascending: false }).limit(200))
        .then(({ data }) => {
          if (cancelled) return
          setTicker((data ?? []) as TickerTrade[])
          setTickerLoading(false)
        })
        .catch(() => { if (!cancelled) setTickerLoading(false) })
    }
    load()
    const channel = supabase
      .channel('ticker-changes')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'ticker' }, load)
      .subscribe()
    // Realtime is the primary delivery path here (same as the
    // opportunities-live-changes effect above) — this interval is only a
    // fallback in case a realtime event is ever missed, not the main way
    // updates land, so it doesn't need to be aggressive. It used to be
    // 3000ms, re-fetching all 200 rows every 3s regardless of whether
    // anything changed, which was most of this page's Supabase egress.
    const interval = setInterval(load, 60000)
    const unsubVisible = onTabVisible(load)
    return () => { cancelled = true; clearInterval(interval); supabase.removeChannel(channel); unsubVisible() }
  }, [])

  // Wins feed — closed, profitable positions from tracked wallets only
  // (opportunity_wallets already only ever contains roster-matched trades,
  // gated upstream in live-signal-service.py's process_trade, so no extra
  // "is this a tracked wallet" filtering is needed here). A close is an
  // UPDATE on opportunity_wallets (exit_ts or market_closed/resolved_ts
  // getting set on an existing row), not an INSERT, and Realtime can't
  // subscribe to wallet_positions directly since it's a view — same
  // "subscribe on the real table just to trigger a refetch" pattern as the
  // ticker effect above, just watching UPDATE instead of INSERT.
  useEffect(() => {
    let cancelled = false
    const load = () => {
      Promise.resolve(
        supabase.from('wallet_positions').select('*')
          .not('closed_at', 'is', null)
          .gt('profit', 0)
          .gte('usd', 100) // matches TICKER_MIN_USD — filters dust-level legs (e.g. multi-leg conversion remainders) that round to "$0" and read as broken
          .order('closed_at', { ascending: false })
          .limit(200)
      )
        .then(({ data }) => {
          if (cancelled) return
          setWins((data ?? []) as WalletPosition[])
          setWinsLoading(false)
        })
        .catch(() => { if (!cancelled) setWinsLoading(false) })
    }
    load()
    const channel = supabase
      .channel('wins-changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'opportunity_wallets' }, load)
      .subscribe()
    const interval = setInterval(load, 60000)
    const unsubVisible = onTabVisible(load)
    return () => { cancelled = true; clearInterval(interval); supabase.removeChannel(channel); unsubVisible() }
  }, [])

  // Win rate / wallet-balance data for the two threshold filters below —
  // both change slowly (win rate only moves on resolution, balance only on
  // the ~15min backend refresh), so this polls far less often than the
  // ticker/opportunities feeds.
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

  // Tracked picks — a personal watchlist (RLS-scoped to auth.uid(), see
  // tracked_picks migration), so this select naturally returns only the
  // signed-in user's own rows with no client-side filtering needed.
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [])

  useEffect(() => {
    Promise.resolve(
      userId
        ? supabase.from('tracked_picks').select('condition_id, outcome')
        : Promise.resolve({ data: [] as { condition_id: string; outcome: string }[] })
    )
      .then(({ data }) => {
        const rows = (data ?? []) as { condition_id: string; outcome: string }[]
        setTrackedPicks(new Set(rows.map(r => `${r.condition_id}::${r.outcome}`)))
      })
      .catch(() => {})
  }, [userId])

  const toggleTrack = (o: Opportunity) => {
    if (!userId) return
    const key = `${o.condition_id}::${o.outcome}`
    const isTracked = trackedPicks.has(key)
    setTrackBusy(key)
    const req = isTracked
      ? Promise.resolve(supabase.from('tracked_picks').delete()
          .eq('user_id', userId).eq('condition_id', o.condition_id).eq('outcome', o.outcome))
      : Promise.resolve(supabase.from('tracked_picks').upsert(
          { user_id: userId, condition_id: o.condition_id, outcome: o.outcome },
          { onConflict: 'user_id,condition_id,outcome', ignoreDuplicates: true }
        ))
    req.then(({ error }) => {
      if (error) throw error
      setTrackedPicks(s => {
        const next = new Set(s)
        if (isTracked) next.delete(key); else next.add(key)
        return next
      })
    }).catch(() => {}).finally(() => setTrackBusy(null))
  }

  const filteredTicker = byCategory(ticker, category)
    .filter(t => !todayOnly || isToday(t.ts))
    .filter(t => {
      if (minWinRate === 0) return true
      const wr = t.wallet ? winRateMap.get(t.wallet) : undefined
      return wr !== undefined && wr * 100 >= minWinRate
    })
    .filter(t => {
      if (minBetRatio === 0) return true
      const bal = t.wallet ? balanceMap.get(t.wallet) : undefined
      // bal === 0 must fail closed, not divide-by-zero into Infinity (which
      // would pass every threshold) — a $0 recorded balance on a wallet
      // that's actively staking money is stale/unsynced data, not a real 0.
      return bal !== undefined && bal > 0 && (t.usd / bal) * 100 >= minBetRatio
    })
    .filter(t => {
      const cents = t.price * 100
      return cents >= minPrice && cents <= maxPrice
    })
    .filter(t => t.usd >= minTotal && (maxTotal >= TOTAL_CAP || t.usd <= maxTotal))
  const filteredWins = byCategory(wins, category)
    .filter(w => !todayOnly || isToday(w.closed_at))
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
    .filter(w => {
      const cents = w.price * 100
      return cents >= minPrice && cents <= maxPrice
    })
    .filter(w => w.usd >= minTotal && (maxTotal >= TOTAL_CAP || w.usd <= maxTotal))
  // Multi-leg fills (a single logical position built/closed across several
  // on-chain legs) show up as several rows for the same wallet+market+
  // outcome — fold those together into one row (summed stake + profit)
  // rather than showing each leg separately. Grouped by key rather than
  // "merge if adjacent": when a market resolves, every wallet holding it
  // gets the identical resolved_ts, so a single wallet's own multiple
  // entries can land non-adjacent within that tied cluster, interleaved
  // with other wallets' rows — a consecutive-only merge missed those and
  // also left duplicate React keys (same wallet+market+outcome+closed_at
  // rendered twice). Map preserves first-seen order, which is the most
  // recent occurrence since filteredWins is already sorted desc.
  const mergedWinsMap = new Map<string, WalletPosition & { legCount: number }>()
  for (const w of filteredWins) {
    const gkey = `${w.wallet}::${w.condition_id}::${w.outcome}`
    const existing = mergedWinsMap.get(gkey)
    if (existing) {
      existing.usd += w.usd
      existing.profit += w.profit
      existing.legCount += 1
    } else {
      mergedWinsMap.set(gkey, { ...w, legCount: 1 })
    }
  }
  const mergedWins = Array.from(mergedWinsMap.values())
  // All discovery filtering + sorting now happens server-side in the query
  // itself (see buildQueryRef above) — the fetched page is already exactly
  // the filtered, sorted set, so nothing left to do here.
  const filteredOpportunities = opportunities
  // Tracked tab intentionally ignores the discovery filters above (category,
  // win rate, price, etc.) — a watchlist shouldn't lose items just because
  // an unrelated filter chip happens to be active elsewhere on the page.
  const trackedOpportunities = opportunities.filter(o => trackedPicks.has(`${o.condition_id}::${o.outcome}`))

  const renderOpportunityCard = (o: Opportunity) => {
    const key = `${o.condition_id}::${o.outcome}`
    const isTracked = trackedPicks.has(key)
    const ic = categoryIcon(o.category)
    const pct = gaugePct(o.entries, o.exited, o.closed)
    const color = gaugeColor(pct)
    // Gauge is a half-circle (top 180°) with the bottom half open — not a
    // full 360° ring — the track and the fill both stop short of meeting
    // at the bottom regardless of pct.
    const r = 32, c = 2 * Math.PI * r
    const arcLen = c * 0.5
    const dash = (pct / 100) * arcLen
    const tag = signalsTag(o.tier, o.cumulative_usd)
    return (
      <div key={key} className="sig-card" onClick={() => setModalOpp(o)}>
        <div className="sig-card-top">
          <div className="sig-card-icon" style={{ background: ic.bg }}>{ic.emoji}</div>
          <div style={{ flex: 1 }}>
            <div className="sig-card-q">{o.title} <span className="sig-out">— {o.outcome}</span></div>
            <div className="sig-card-meta">{o.wallet_count} top trader{o.wallet_count > 1 ? 's' : ''}</div>
          </div>
          {marketUrl(o.event_slug || o.slug) && (
            <a
              className="sig-track-btn"
              href={marketUrl(o.event_slug || o.slug)!}
              target="_blank"
              rel="noopener noreferrer"
              onClick={e => e.stopPropagation()}
              title="Open market on Polymarket"
            >
              <ExternalLink size={15} />
            </a>
          )}
          {userId && (
            <button
              className="sig-track-btn"
              disabled={trackBusy === key}
              onClick={e => { e.stopPropagation(); toggleTrack(o) }}
              title={isTracked ? 'Untrack this pick' : 'Track this pick'}
            >
              <Star size={15} fill={isTracked ? '#f2b73f' : 'none'} color={isTracked ? '#f2b73f' : 'currentColor'} />
            </button>
          )}
          <div style={{ fontSize: 12.5, fontWeight: 700, color: o.total_profit >= 0 ? '#00d17a' : '#ff3b5c', flexShrink: 0 }}>
            {fmtSigned(o.total_profit)}
          </div>
        </div>
        <div className="sig-gauge-row">
          <div className="sig-gauge">
            <svg width="80" height="80" viewBox="0 0 80 80">
              <circle cx="40" cy="40" r={r} fill="none" stroke="#33363d" strokeWidth="7"
                strokeDasharray={`${arcLen} ${c}`} strokeLinecap="round" />
              <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="7"
                strokeDasharray={`${dash} ${c}`} strokeLinecap="round" />
            </svg>
            <div className="sig-gauge-label">
              <div className="sig-gauge-pct">{pct}%</div>
              <div className="sig-gauge-sub">in</div>
            </div>
          </div>
          <div className="sig-stat-col">
            <div className="sig-stat"><span className="sig-stat-label">Price</span><span className="sig-stat-val">{Math.round(o.latest_price * 100)}¢</span></div>
            <div className="sig-stat"><span className="sig-stat-label">Total</span><span className="sig-stat-val g">{fmtFull(o.cumulative_usd)}</span></div>
            {o.scalped > 0 && (
              <div className="sig-stat"><span className="sig-stat-label">Scalped</span><span className="sig-stat-val r">{o.scalped}</span></div>
            )}
            {o.best_win_rate > 0 && (
              <div className="sig-stat"><span className="sig-stat-label">Best win rate</span><span className="sig-stat-val">{Math.round(o.best_win_rate * 100)}%</span></div>
            )}
            {o.best_bet_ratio > 0 && (
              <div className="sig-stat"><span className="sig-stat-label">Best bet ratio</span><span className="sig-stat-val">{Math.round(o.best_bet_ratio * 100)}%</span></div>
            )}
          </div>
        </div>
        <div className={`sig-tag ${tag.cls}`}>{tag.label}</div>
      </div>
    )
  }

  return (
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Top Trader Signals</h1>
          <p className="app-section-sub">
            {loading ? 'Loading live signals…'
              : error ? 'Could not reach the signals backend'
              : <>{opportunities.length} live opportunities · capital-weighted conviction from top traders</>}
          </p>
        </div>
        {!error && <div className="sig-live">LIVE</div>}
      </div>

      <div className="sig-panel">
        <div className="sig-head">
          {error && (
            <div style={{ color: '#ff3b5c', padding: '0 0 20px', fontSize: '0.875rem' }}>
              {error} — check your Supabase connection and that `python3 scripts/live-signal-service.py` is running.
            </div>
          )}

          <div className="sig-seg">
            <div className={tab === 'ticker' ? 'sig-seg-btn active' : 'sig-seg-btn'} onClick={() => setTab('ticker')}>Live Ticker</div>
            <div className={tab === 'wins' ? 'sig-seg-btn active' : 'sig-seg-btn'} onClick={() => setTab('wins')}>Winners</div>
            <div className={tab === 'vetted' ? 'sig-seg-btn active' : 'sig-seg-btn'} onClick={() => setTab('vetted')}>Vetted Picks</div>
            <div className={tab === 'tracked' ? 'sig-seg-btn active' : 'sig-seg-btn'} onClick={() => setTab('tracked')}>
              Tracked{trackedPicks.size > 0 ? ` (${trackedPicks.size})` : ''}
            </div>
          </div>

          <div className="sig-filters">
            <div className="sig-filter-group">
              <div
                className={todayOnly ? 'sig-chip active' : 'sig-chip'}
                style={{ alignSelf: 'flex-start' }}
                onClick={() => setTodayOnly(t => !t)}
              >
                Today only
              </div>
            </div>

            <div className="sig-filter-group">
              <span className="sig-filter-label">Win rate</span>
              <div className="sig-chips">
                {[0, 50, 65, 80].map(v => (
                  <div key={v} className={minWinRate === v ? 'sig-chip active' : 'sig-chip'} onClick={() => setMinWinRate(v)}>
                    {v === 0 ? 'Any' : `${v}%+`}
                  </div>
                ))}
              </div>
            </div>

            <div className="sig-filter-group">
              <span className="sig-filter-label">Bet vs wallet balance</span>
              <div className="sig-chips">
                {[0, 5, 15, 30].map(v => (
                  <div key={v} className={minBetRatio === v ? 'sig-chip active' : 'sig-chip'} onClick={() => setMinBetRatio(v)}>
                    {v === 0 ? 'Any' : `${v}%+`}
                  </div>
                ))}
              </div>
            </div>

            <div className="sig-filter-group sig-price-range">
              <span className="sig-filter-label">Price range: {minPrice}¢ – {maxPrice}¢</span>
              <div className="sig-range-track-wrap">
                <div className="sig-range-track" />
                <div className="sig-range-fill" style={{ left: `${minPrice}%`, right: `${100 - maxPrice}%` }} />
                <input
                  type="range" min={0} max={100} value={minPrice}
                  onChange={e => setMinPrice(Math.min(Number(e.target.value), maxPrice - 1))}
                  className="sig-range-input"
                />
                <input
                  type="range" min={0} max={100} value={maxPrice}
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
                  type="range" min={0} max={100} step={0.5} value={totalPos(minTotal)}
                  onChange={e => setMinTotal(Math.min(totalVal(Number(e.target.value)), maxTotal - 100))}
                  className="sig-range-input"
                />
                <input
                  type="range" min={0} max={100} step={0.5} value={totalPos(maxTotal)}
                  onChange={e => setMaxTotal(Math.max(totalVal(Number(e.target.value)), minTotal + 100))}
                  className="sig-range-input"
                />
              </div>
            </div>

            {tab === 'vetted' && (
              <div className="sig-filter-group sig-price-range">
                <span className="sig-filter-label">
                  Amount won: {minWon <= WON_FLOOR ? 'no limit' : fmtSigned(minWon)} – {maxWon >= WON_CAP ? 'no limit' : fmtSigned(maxWon)}
                </span>
                <div className="sig-range-track-wrap">
                  <div className="sig-range-track" />
                  <div className="sig-range-fill" style={{
                    left: `${((minWon - WON_FLOOR) / (WON_CAP - WON_FLOOR)) * 100}%`,
                    right: `${100 - ((maxWon - WON_FLOOR) / (WON_CAP - WON_FLOOR)) * 100}%`,
                  }} />
                  <input
                    type="range" min={WON_FLOOR} max={WON_CAP} step={250} value={minWon}
                    onChange={e => setMinWon(Math.min(Number(e.target.value), maxWon - 250))}
                    className="sig-range-input"
                  />
                  <input
                    type="range" min={WON_FLOOR} max={WON_CAP} step={250} value={maxWon}
                    onChange={e => setMaxWon(Math.max(Number(e.target.value), minWon + 250))}
                    className="sig-range-input"
                  />
                </div>
              </div>
            )}

            {tab === 'vetted' && (
              <div className="sig-filter-group sig-price-range">
                <span className="sig-filter-label">
                  Trader size: {minTraders} – {maxTraders >= TRADERS_CAP ? `${TRADERS_CAP}+` : maxTraders}
                </span>
                <div className="sig-range-track-wrap">
                  <div className="sig-range-track" />
                  <div className="sig-range-fill" style={{
                    left: `${((minTraders - 1) / (TRADERS_CAP - 1)) * 100}%`,
                    right: `${100 - ((maxTraders - 1) / (TRADERS_CAP - 1)) * 100}%`,
                  }} />
                  <input
                    type="range" min={1} max={TRADERS_CAP} step={1} value={minTraders}
                    onChange={e => setMinTraders(Math.min(Number(e.target.value), maxTraders - 1))}
                    className="sig-range-input"
                  />
                  <input
                    type="range" min={1} max={TRADERS_CAP} step={1} value={maxTraders}
                    onChange={e => setMaxTraders(Math.max(Number(e.target.value), minTraders + 1))}
                    className="sig-range-input"
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {tab === 'ticker' && (
          <div className="lb-table">
            <div className="lb-head lb-4col">
              <div>Trader</div>
              <div>Market</div>
              <div className="lb-col">Price</div>
              <div className="lb-col">Size</div>
            </div>
            {tickerLoading && Array.from({ length: 8 }).map((_, i) => <SkelLbRow key={i} />)}
            {!tickerLoading && filteredTicker.length === 0 && (
              <div className="sig-empty">Waiting for a big trade…</div>
            )}
            {!tickerLoading && filteredTicker.map(t => {
              const ic = categoryIcon(t.category)
              return (
                <div key={t.id} className="lb-row lb-4col">
                  <div className="lb-trader">
                    <div className="lb-avatar" style={{ background: avatarGradient(t.wallet) }}>{avatarInitial(t.wallet, t.wallet_name)}</div>
                    <div style={{ minWidth: 0 }}>
                      {t.wallet ? (
                        <a href={profileUrl(t.wallet)!} target="_blank" rel="noopener noreferrer" className="lb-name">
                          {traderLabel(t.wallet, t.wallet_name)}
                        </a>
                      ) : (
                        <span className="lb-name">someone</span>
                      )}
                      <div className="lb-sub">
                        {t.roster_tagged ? <span className="sig-trk" style={{ marginRight: 5 }}>Tracked</span> : null}
                        {timeAgo(t.ts)}
                      </div>
                    </div>
                  </div>

                  <div className="lb-market">
                    <div className="sig-q">{t.title} <span className="sig-out">— {t.outcome}</span></div>
                  </div>

                  <div className="lb-col" data-label="Price">
                    <div className="lb-col-stack">
                      <div className="lb-val">{Math.round(t.price * 100)}¢</div>
                      <div className="lb-val-sub" style={{ color: t.side === 'BUY' ? 'var(--green)' : 'var(--red)' }}>{t.side}</div>
                    </div>
                  </div>

                  <div className="lb-col" data-label="Size">
                    <div className="lb-col-stack">
                      <div className="lb-val">{fmtFull(t.usd)}</div>
                      <div className="lb-val-sub" style={{ color: 'var(--text-faint)' }}>{ic.emoji} {categoryLabel(t.category ?? 'other')}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'wins' && (
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
                    <div className="lb-avatar" style={{ background: avatarGradient(w.wallet) }}>{avatarInitial(w.wallet, w.wallet_name)}</div>
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

                  <div className="lb-col" data-label="PnL">
                    <div className="lb-col-stack">
                      <div className="lb-val g">{fmtSigned(w.profit)}</div>
                      <div className="lb-val-sub" style={{ color: 'var(--green)' }}>▲ {roi.toFixed(1)}%</div>
                    </div>
                  </div>

                  <div className="lb-col" data-label="Staked">
                    <div className="lb-col-stack">
                      <div className="lb-val">{fmtFull(w.usd)}</div>
                      <div className="lb-val-sub" style={{ color: 'var(--text-faint)' }}>{w.legCount > 1 ? `${w.legCount} legs` : '1 leg'}</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'vetted' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <div className={sortMode === 'recent' ? 'sig-chip active' : 'sig-chip'} onClick={() => setSortMode('recent')}>Most recent</div>
              <div className={sortMode === 'profit' ? 'sig-chip active' : 'sig-chip'} onClick={() => setSortMode('profit')}>Most profitable</div>
            </div>
          <div className="sig-grid">
            {loading && Array.from({ length: 8 }).map((_, i) => <SkelCard key={i} />)}
            {!loading && filteredOpportunities.length === 0 && (
              <div className="sig-empty">No opportunities detected yet — the live backend hasn't caught a tracked trader's trade yet. This is normal; keep it running.</div>
            )}
            {!loading && filteredOpportunities.map(renderOpportunityCard)}
          </div>
          {!loading && hasMore && (
            <button className="sig-load-more" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
          </>
        )}

        {tab === 'tracked' && (
          <div className="sig-grid">
            {!userId && (
              <div className="sig-empty">Sign in to track picks.</div>
            )}
            {userId && trackedOpportunities.length === 0 && (
              <div className="sig-empty">No tracked picks yet — star a signal from Vetted Picks to add it here.</div>
            )}
            {userId && trackedOpportunities.map(renderOpportunityCard)}
          </div>
        )}

        <div className="sig-foot">
          {tab === 'ticker' ? 'Raw trade activity, $100+ · not a recommendation'
            : tab === 'wins' ? 'Closed, profitable positions from tracked wallets · not a recommendation'
            : 'Positions still open, weighted by trader conviction'}
        </div>
      </div>

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

export default SignalsDemo
