import { useState, useEffect, useCallback, useMemo } from 'react'
import { ArrowUp, ArrowDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { dashboardPath } from '../lib/domains'
import { traderLabel, fmtSigned, fmtFull, timeAgo, addToWatchedWallets, removeFromWatchedWallets } from './helpers'
import { SkelStatsRow, SkelTableRows, SkelBlock } from './Skeleton'
import {
  CumulativeChartSection, HighlightsRow, CategoryBreakdownSection, SimilarTradersTable,
  type CategoryRow, type SimilarTrader,
} from './TraderResultWidgets'

/* ── Trader detail ──
   The authenticated in-app equivalent of the public SearchPage.tsx — same
   widgets (see TraderResultWidgets.tsx), but reached via Lookup/Leaderboard
   instead of a cold search, and always fully entitled (ProtectedRoute
   already requires an active subscription to get here at all), so there's
   no locked/blurred branch to build — every section either has data or
   doesn't render, same as SearchPage's own entitled-only sections. Data
   comes from direct RLS-scoped queries rather than the wallet-search Edge
   Function, since an authenticated caller already has real table access
   and going through the function would just add a redundant network hop. */
interface TraderSummary {
  wallet: string
  wallet_name: string | null
  n: number
  won: number
  lost: number
  deployed: number
  won_usd: number
  net_profit: number
}

interface TraderPosition {
  title: string
  outcome: string
  category: string | null
  condition_id: string
  usd: number
  price: number
  resolved_win: boolean
  resolved_ts: string
  profit: number
}

interface LivePosition {
  title: string
  outcome: string
  conditionId: string
  curPrice: number
  avgPrice: number
  cashPnl: number
  realizedPnl: number
  redeemable: boolean
  size?: number
}

interface LiveClosedPosition {
  title: string
  outcome: string
  conditionId: string
  avgPrice: number
  curPrice: number
  realizedPnl: number
  timestamp: number
}

interface LiveTrade {
  timestamp: number
  side: string
  title: string
  outcome: string
  size: number
  price: number
}

// Mirrors the wallet-search Edge Function's findSimilarTraders — same
// overlap logic, just as a direct client-side query instead of Deno
// server-side code, since those are two different runtimes that can't
// share a function body. Other tracked wallets with positions in the same
// (condition_id, outcome) pairs this wallet has touched.
async function findSimilarTraders(
  pairs: { condition_id: string; outcome: string }[], excludeWallet: string,
): Promise<SimilarTrader[]> {
  const ownPairs = new Set(pairs.map(p => `${p.condition_id}|${p.outcome}`))
  const conditionIds = [...new Set(pairs.map(p => p.condition_id))].slice(0, 50)
  if (conditionIds.length === 0) return []

  const { data: overlapRows } = await supabase
    .from('opportunity_wallets')
    .select('wallet, condition_id, outcome')
    .in('condition_id', conditionIds)
    .neq('wallet', excludeWallet)

  const overlapCounts = new Map<string, number>()
  for (const row of (overlapRows ?? []) as { wallet: string; condition_id: string; outcome: string }[]) {
    if (!ownPairs.has(`${row.condition_id}|${row.outcome}`)) continue
    overlapCounts.set(row.wallet, (overlapCounts.get(row.wallet) ?? 0) + 1)
  }

  const candidateWallets = [...overlapCounts.keys()]
  if (candidateWallets.length === 0) return []

  const { data: candidateLeaderboard } = await supabase
    .from('leaderboard').select('wallet, wallet_name, net_profit').in('wallet', candidateWallets)

  return (candidateLeaderboard ?? [])
    .map(l => ({
      wallet: l.wallet as string,
      walletName: l.wallet_name as string | null,
      overlap: overlapCounts.get(l.wallet as string) ?? 0,
      netProfit: l.net_profit as number,
    }))
    .sort((a, b) => b.overlap - a.overlap || b.netProfit - a.netProfit)
    .slice(0, 5)
}

// A single button doubling as two controls, same as Polymarket's own
// positions sort: the arrow icon on the left flips ascending/descending in
// place (stopPropagation so it doesn't also open the menu), the rest of the
// button opens a dropdown to pick which field drives the sort.
function SortControl<T extends string>({ options, value, onChange, dir, onToggleDir }: {
  options: { value: T; label: string }[]
  value: T
  onChange: (v: T) => void
  dir: 'asc' | 'desc'
  onToggleDir: () => void
}) {
  const [open, setOpen] = useState(false)
  const currentLabel = options.find(o => o.value === value)?.label ?? ''
  return (
    <div style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button" className="sig-filter-input sig-sort-btn"
        onClick={() => setOpen(o => !o)}
      >
        <span
          role="button" tabIndex={0} title={dir === 'desc' ? 'Descending — click to flip' : 'Ascending — click to flip'}
          className="sig-sort-dir"
          onClick={e => { e.stopPropagation(); onToggleDir() }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); onToggleDir() } }}
        >
          {dir === 'desc' ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
        </span>
        {currentLabel}
      </button>
      {open && (
        <>
          <div className="sig-sort-backdrop" onClick={() => setOpen(false)} />
          <div className="sig-sort-menu">
            {options.map(o => (
              <button
                key={o.value} type="button"
                className={`sig-sort-menu-item ${o.value === value ? 'active' : ''}`}
                onClick={() => {
                  // Re-picking the field that's already active flips direction
                  // instead of no-opping — same as clicking the arrow icon.
                  if (o.value === value) onToggleDir()
                  else onChange(o.value)
                  setOpen(false)
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function TraderDetailPage({ wallet, linkToTrader = w => dashboardPath(`/trader/${w}`), chartHeight = 220, terminalLayout = false }: {
  wallet: string
  // Overridable so the Terminal (its own self-contained route tree, see
  // src/app/terminal/) can keep "jump to another wallet"/similar-traders
  // navigation inside itself instead of bouncing out to the main app's
  // /trader/:wallet route, which is what dashboardPath always points to.
  linkToTrader?: (wallet: string) => string
  // Same reasoning as MarketDetailContent's identical prop — the Terminal
  // has a full page to work with, so it passes a taller value here too.
  terminalLayout?: boolean
  chartHeight?: number
}) {
  const [summary, setSummary] = useState<TraderSummary | null>(null)
  const [positions, setPositions] = useState<TraderPosition[]>([])
  const [byCategory, setByCategory] = useState<CategoryRow[]>([])
  const [similarTraders, setSimilarTraders] = useState<SimilarTrader[]>([])
  // Split so each section paints as soon as its own query resolves instead
  // of every section waiting on the slowest of the three — summary comes
  // from the cached leaderboard view (fast) while positions/category are
  // live-aggregated and can take much longer for high-volume wallets, so
  // gating everything behind one flag meant the whole page sat on a single
  // blank skeleton for as long as the slowest query took.
  const [summaryLoading, setSummaryLoading] = useState(true)
  const [positionsLoading, setPositionsLoading] = useState(true)
  const [categoryLoading, setCategoryLoading] = useState(true)
  const [similarLoading, setSimilarLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [livePositions, setLivePositions] = useState<LivePosition[]>([])
  const [liveClosed, setLiveClosed] = useState<LiveClosedPosition[]>([])
  const [liveTrades, setLiveTrades] = useState<LiveTrade[]>([])
  const [liveLoading, setLiveLoading] = useState(false)
  // Reveals 50 more rows per click instead of an all-or-nothing toggle —
  // jumping straight from 10 rows to potentially 1000+ table rows in one
  // go is the same kind of DOM-size performance issue the chart markers
  // cap (PriceChart.tsx) already fixed.
  const [visibleTrades, setVisibleTrades] = useState(10)
  const [visibleLive, setVisibleLive] = useState(10)
  const PAGE_STEP = 50
  // Separate from `liveLoading` (which gates the untracked-wallet fallback
  // branch below) — this one covers the always-fetched open-positions call
  // that now runs for tracked wallets too, so a tracked wallet's own
  // skeleton doesn't accidentally piggyback on the fallback branch's flag.
  const [openPositionsLoading, setOpenPositionsLoading] = useState(true)
  const [resolvedSort, setResolvedSort] = useState<'date' | 'profit'>('profit')
  const [activeSort, setActiveSort] = useState<'value' | 'price' | 'pnl'>('value')
  // Shared across both tabs rather than one flag per tab — only one tab is
  // ever visible at a time, and there's no real expectation that flipping
  // direction on Closed should leave Active in a different, forgotten state.
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [positionsTab, setPositionsTab] = useState<'active' | 'closed'>('closed')
  const [positionsSearch, setPositionsSearch] = useState('')
  const [userId, setUserId] = useState<string | null>(null)
  const [trackedWallets, setTrackedWallets] = useState<Record<string, boolean>>({})
  const [busyWallet, setBusyWallet] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [])

  const loadTrackedStatus = useCallback((wallets: string[]) => {
    if (wallets.length === 0) return
    Promise.resolve(supabase.from('tracked_wallets').select('wallet').in('wallet', wallets))
      .then(({ data }) => {
        const trackedSet = new Set(((data ?? []) as { wallet: string }[]).map(w => w.wallet))
        setTrackedWallets(prev => {
          const next = { ...prev }
          for (const w of wallets) next[w] = trackedSet.has(w)
          return next
        })
      })
      .catch(() => {})
  }, [])

  const trackWallet = (w: string) => {
    setBusyWallet(w)
    Promise.resolve(supabase.from('tracked_wallets').upsert({ wallet: w, added_by: userId }, { onConflict: 'wallet', ignoreDuplicates: true }))
      .then(({ error: err }) => {
        if (err) throw err
        setTrackedWallets(s => ({ ...s, [w]: true }))
        addToWatchedWallets(w)
      })
      .catch(() => {})
      .finally(() => setBusyWallet(null))
  }

  const untrackWallet = (w: string) => {
    setBusyWallet(w)
    Promise.resolve(supabase.from('tracked_wallets').delete().eq('wallet', w))
      .then(({ error: err }) => {
        if (err) throw err
        setTrackedWallets(s => ({ ...s, [w]: false }))
        removeFromWatchedWallets(w)
      })
      .catch(() => {})
      .finally(() => setBusyWallet(null))
  }

  useEffect(() => {
    let cancelled = false
    setSummaryLoading(true)
    setPositionsLoading(true)
    setCategoryLoading(true)
    setError(null)

    // Every wallet address in the DB is stored lowercase — these queries
    // used to rely on .ilike() for a free case-insensitive match, but ilike
    // can't use the wallet btree index (confirmed live: ~2.4s for a
    // 136k-trade wallet vs ~1s with plain equality on the same query).
    // Normalizing here instead keeps case-insensitivity for a
    // manually-typed/pasted mixed-case URL while letting these use a real
    // indexed equality lookup.
    const w = wallet.toLowerCase()

    // Three independent fetches instead of one Promise.all — summary comes
    // from the cached leaderboard view and is typically fast, so it paints
    // (stats row + Follow button) well before positions/category resolve
    // instead of the whole page waiting on whichever of the three is slowest.
    Promise.resolve(supabase.from('leaderboard').select('*').eq('wallet', w).maybeSingle())
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) throw err
        const summaryData = (data ?? null) as TraderSummary | null
        setSummary(summaryData)
        setSummaryLoading(false)
        loadTrackedStatus([wallet])

        // Open positions always come straight from Polymarket's own public
        // data API, tracked wallet or not — our tables only ever carry
        // resolved history (wallet_positions/opportunity_wallets has no
        // concept of "still open"), so this is the only source of truth for
        // "what are they holding right now" regardless of whether we've
        // been tracking this wallet's past trades ourselves.
        setOpenPositionsLoading(true)
        fetch(`https://data-api.polymarket.com/positions?user=${wallet}&limit=50`)
          .then(r => r.ok ? r.json() : [])
          .then(pos => { if (!cancelled) setLivePositions((pos ?? []) as LivePosition[]) })
          .catch(() => {})
          .finally(() => { if (!cancelled) setOpenPositionsLoading(false) })

        if (!summaryData) {
          // We only have resolved history for wallets we've tracked
          // ourselves — for everyone else, fall back to Polymarket's public
          // data API for closed positions/trades too, so "no tracked
          // history" doesn't mean "we can't show you anything real."
          setLiveLoading(true)
          Promise.all([
            fetch(`https://data-api.polymarket.com/closed-positions?user=${wallet}&limit=200`).then(r => r.ok ? r.json() : []),
            fetch(`https://data-api.polymarket.com/trades?user=${wallet}&limit=30`).then(r => r.ok ? r.json() : []),
          ])
            .then(([closed, trades]) => {
              if (cancelled) return
              const liveClosedPos = (closed ?? []) as LiveClosedPosition[]
              setLiveClosed(liveClosedPos)
              setLiveTrades((trades ?? []) as LiveTrade[])
              const pairs = liveClosedPos
                .filter(p => p.conditionId && p.outcome)
                .map(p => ({ condition_id: p.conditionId, outcome: p.outcome }))
              setSimilarLoading(true)
              findSimilarTraders(pairs, wallet).then(st => {
                if (cancelled) return
                setSimilarTraders(st)
                loadTrackedStatus(st.map(t => t.wallet))
              }).catch(() => {}).finally(() => { if (!cancelled) setSimilarLoading(false) })
            })
            .catch(() => {})
            .finally(() => { if (!cancelled) setLiveLoading(false) })
        }
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message)
        setSummaryLoading(false)
      })

    Promise.resolve(supabase.from('wallet_positions').select('*').eq('wallet', w).eq('market_closed', true).order('resolved_ts', { ascending: false }))
      .then(({ data, error: err }) => {
        if (cancelled) return
        if (err) throw err
        const positionsData = (data ?? []) as TraderPosition[]
        setPositions(positionsData)
        setPositionsLoading(false)
        // Only the tracked-history branch drives similar traders off our own
        // positions — the live-fallback branch above computes its own pairs
        // once summary comes back null, so an empty tracked result here
        // (untracked wallet) correctly does nothing rather than double-fire.
        if (positionsData.length > 0) {
          setSimilarLoading(true)
          findSimilarTraders(positionsData, wallet).then(st => {
            if (cancelled) return
            setSimilarTraders(st)
            loadTrackedStatus(st.map(t => t.wallet))
          }).catch(() => {}).finally(() => { if (!cancelled) setSimilarLoading(false) })
        }
      })
      .catch(() => { if (!cancelled) setPositionsLoading(false) })

    Promise.resolve(supabase.from('wallet_category_breakdown').select('*').eq('wallet', w).order('profit', { ascending: false }))
      .then(({ data }) => {
        if (cancelled) return
        setByCategory((data ?? []) as CategoryRow[])
        setCategoryLoading(false)
      })
      .catch(() => { if (!cancelled) setCategoryLoading(false) })

    return () => { cancelled = true }
  }, [wallet, loadTrackedStatus])

  const winRate = summary && summary.won + summary.lost > 0 ? (summary.won / (summary.won + summary.lost)) * 100 : 0
  const usdWinRate = summary && summary.deployed > 0 ? (summary.won_usd / summary.deployed) * 100 : 0
  const roi = summary && summary.deployed > 0 ? (summary.net_profit / summary.deployed) * 100 : 0

  // Raw `positions` is one row per fill — a single market can carry dozens
  // of partial fills at slightly different prices/timestamps (see: any
  // high-volume tracked wallet), which read as spam duplicates in a table.
  // Polymarket's own UI collapses these into one row per (market, outcome);
  // this mirrors that. avgPrice is share-weighted (usd/price ≈ shares per
  // fill), not a naive average of the per-fill prices, so it reflects what
  // was actually paid across the whole position rather than over-weighting
  // a handful of small fills at an outlier price.
  const aggregatedPositions = useMemo(() => {
    const map = new Map<string, {
      title: string; outcome: string; totalStake: number; totalShares: number
      totalProfit: number; resolvedWin: boolean; latestResolvedTs: string; fills: number
    }>()
    for (const p of positions) {
      const key = `${p.condition_id}|${p.outcome}`
      const shares = p.price > 0 ? p.usd / p.price : 0
      const existing = map.get(key)
      if (existing) {
        existing.totalStake += p.usd
        existing.totalShares += shares
        existing.totalProfit += p.profit
        existing.fills += 1
        if (p.resolved_ts > existing.latestResolvedTs) existing.latestResolvedTs = p.resolved_ts
      } else {
        map.set(key, {
          title: p.title, outcome: p.outcome, totalStake: p.usd, totalShares: shares,
          totalProfit: p.profit, resolvedWin: p.resolved_win, latestResolvedTs: p.resolved_ts, fills: 1,
        })
      }
    }
    const rows = [...map.values()].map(r => ({
      ...r, avgPrice: r.totalShares > 0 ? r.totalStake / r.totalShares : 0,
    }))
    const dirMul = sortDir === 'asc' ? 1 : -1
    const cmp = resolvedSort === 'profit'
      ? (a: typeof rows[number], b: typeof rows[number]) => a.totalProfit - b.totalProfit
      : (a: typeof rows[number], b: typeof rows[number]) => new Date(a.latestResolvedTs).getTime() - new Date(b.latestResolvedTs).getTime()
    return rows.sort((a, b) => dirMul * cmp(a, b))
  }, [positions, resolvedSort, sortDir])

  const trackedCumulative = [...positions]
    .sort((a, b) => new Date(a.resolved_ts).getTime() - new Date(b.resolved_ts).getTime())
    .reduce<{ d: string; cum: number }[]>((acc, p) => {
      const prevCum = acc.length > 0 ? acc[acc.length - 1].cum : 0
      acc.push({ d: p.resolved_ts, cum: prevCum + p.profit })
      return acc
    }, [])

  // Live-fallback stats, computed the same way check_market_closed already
  // does server-side: a resolved outcome settles at 0 or 1, so curPrice >= 0.5
  // means that side won.
  const sortedLiveClosed = [...liveClosed].sort((a, b) => b.timestamp - a.timestamp)
  const liveWon = sortedLiveClosed.filter(p => p.curPrice >= 0.5).length
  const liveWinRate = sortedLiveClosed.length > 0 ? (liveWon / sortedLiveClosed.length) * 100 : 0
  const liveRealizedPnl = sortedLiveClosed.reduce((sum, p) => sum + p.realizedPnl, 0)
  const liveCumulative = [...sortedLiveClosed].reverse()
    .reduce<{ d: string; cum: number }[]>((acc, p) => {
      const prevCum = acc.length > 0 ? acc[acc.length - 1].cum : 0
      acc.push({ d: new Date(p.timestamp * 1000).toISOString(), cum: prevCum + p.realizedPnl })
      return acc
    }, [])

  return (
    <div className={`sig-page ${terminalLayout && summary ? 'terminal-trader-profile' : ''}`}>
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">{traderLabel(wallet, summary?.wallet_name ?? null)}</h1>
          <p className="app-section-sub">
            {summaryLoading ? (
              <span className="sig-skel" style={{ display: 'inline-block', width: 140, height: 12, borderRadius: 4, verticalAlign: 'middle' }} />
            ) : error ? 'Connection trouble — retrying…' : (
              trackedWallets[wallet] ? (
                <button type="button" className="sig-watch-remove terminal-follow" style={terminalLayout ? undefined : { border: 0, background: 'none', padding: 0, font: 'inherit', cursor: 'pointer' }} disabled={busyWallet === wallet} onClick={() => untrackWallet(wallet)}>
                  {busyWallet === wallet ? 'Removing…' : 'Unfollow'}
                </button>
              ) : (
                <button type="button" className="terminal-follow" style={terminalLayout ? undefined : { border: 0, background: 'none', padding: 0, font: 'inherit', cursor: 'pointer', color: 'var(--blue)' }} disabled={busyWallet === wallet} onClick={() => trackWallet(wallet)}>
                  {busyWallet === wallet ? 'Adding…' : '+ Follow this trader'}
                </button>
              )
            )}
          </p>
        </div>
      </div>

      <div className="sig-panel">
        {error && (
          <div style={{ color: '#ff3b5c', padding: '0 0 20px', fontSize: '0.875rem' }}>{error}</div>
        )}

        {/* Rendered speculatively while summary is still loading (not just
            once it resolves truthy) — the vast majority of wallets reached
            via internal links (leaderboard rows, contributing-trader lists)
            are tracked, so this avoids the whole grid popping into existence
            at once the moment summary resolves. The rare untracked case
            still swaps cleanly to the live-fallback branch below once we
            know for sure. */}
        {!error && (summaryLoading || summary) && (
          <>
            {summaryLoading ? <SkelStatsRow count={5} /> : summary && (
              <div className="sig-stats-row" style={{ marginBottom: 24 }}>
                <div className="sig-stat-cell">
                  <div className="sig-stat-cell-label">Net P&L</div>
                  <div className={`sig-stat-cell-val ${summary.net_profit >= 0 ? 'g' : 'r'}`}>{fmtSigned(summary.net_profit)}</div>
                </div>
                <div className="sig-stat-cell">
                  <div className="sig-stat-cell-label" title="Winning trades ÷ total resolved trades">Win Rate (#)</div>
                  <div className="sig-stat-cell-val">{winRate.toFixed(1)}%</div>
                </div>
                <div className="sig-stat-cell">
                  <div className="sig-stat-cell-label" title="Dollars in winning trades ÷ total dollars deployed">Win Rate ($)</div>
                  <div className="sig-stat-cell-val">{usdWinRate.toFixed(1)}%</div>
                </div>
                <div className="sig-stat-cell">
                  <div className="sig-stat-cell-label">ROI</div>
                  <div className={`sig-stat-cell-val ${roi >= 0 ? 'g' : 'r'}`}>{roi >= 0 ? '+' : ''}{roi.toFixed(1)}%</div>
                </div>
                <div className="sig-stat-cell">
                  <div className="sig-stat-cell-label">Resolved Trades</div>
                  <div className="sig-stat-cell-val">{summary.n}</div>
                </div>
              </div>
            )}

            <div className="search-dashboard-grid">
              <div className="search-dashboard-main">
                {positionsLoading ? (
                  <SkelBlock height={chartHeight} style={{ marginBottom: 24 }} />
                ) : (
                  <CumulativeChartSection data={trackedCumulative} label="P&L over time" height={chartHeight} />
                )}

                {/* One table, an Active/Closed toggle switching what feeds it —
                    mirrors Polymarket's own positions view exactly (tabs, search,
                    sort dropdown, single RESULT/MARKET/TOTAL TRADED/AMOUNT table)
                    instead of two separately-labeled tables stacked on the page. */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
                  <div className="sig-seg" role="tablist" style={{ margin: 0, gap: 8 }}>
                    <button
                      type="button" role="tab" aria-selected={positionsTab === 'active'}
                      className={`sig-seg-btn ${positionsTab === 'active' ? 'active' : ''}`}
                      onClick={() => setPositionsTab('active')}
                    >
                      Active{!openPositionsLoading && livePositions.length > 0 ? ` (${livePositions.length})` : ''}
                    </button>
                    <button
                      type="button" role="tab" aria-selected={positionsTab === 'closed'}
                      className={`sig-seg-btn ${positionsTab === 'closed' ? 'active' : ''}`}
                      onClick={() => setPositionsTab('closed')}
                    >
                      Closed
                    </button>
                  </div>
                  <input
                    type="text" placeholder="Search positions" value={positionsSearch}
                    onChange={e => setPositionsSearch(e.target.value)}
                    className="sig-filter-input" style={{ flex: 1, minWidth: 160 }}
                  />
                  {positionsTab === 'closed' && (
                    <SortControl
                      options={[{ value: 'date', label: 'Date' }, { value: 'profit', label: 'Profit/Loss' }]}
                      value={resolvedSort} onChange={setResolvedSort}
                      dir={sortDir} onToggleDir={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                    />
                  )}
                  {positionsTab === 'active' && (
                    <SortControl
                      options={[{ value: 'value', label: 'Value' }, { value: 'price', label: 'Price' }, { value: 'pnl', label: 'Unrealized P&L' }]}
                      value={activeSort} onChange={setActiveSort}
                      dir={sortDir} onToggleDir={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                    />
                  )}
                </div>

                {positionsTab === 'active' && (
                  <>
                    <div className="sig-table-wrap">
                      <table className="sig-table">
                        <thead>
                          <tr><th>Market</th><th>Result</th><th className="num">Total Traded</th><th className="num">Amount</th></tr>
                        </thead>
                        <tbody>
                          {openPositionsLoading && <SkelTableRows cols={4} count={5} />}
                          {!openPositionsLoading && livePositions
                            .filter(p => !positionsSearch || p.title.toLowerCase().includes(positionsSearch.toLowerCase()))
                            .map(p => ({ ...p, totalTraded: p.size != null ? p.size * p.avgPrice : null }))
                            .map(p => ({ ...p, value: p.totalTraded != null ? p.totalTraded + p.cashPnl : null }))
                            .sort((a, b) => {
                              const dirMul = sortDir === 'asc' ? 1 : -1
                              const field = (x: typeof a) => activeSort === 'price' ? x.curPrice : activeSort === 'pnl' ? x.cashPnl : (x.value ?? 0)
                              return dirMul * (field(a) - field(b))
                            })
                            .map((p, i) => {
                              const totalTraded = p.totalTraded
                              const amount = p.value
                              return (
                                <tr key={i}>
                                  <td>
                                    {p.title} <span style={{ color: 'var(--text-dim)' }}>— {p.outcome}</span>
                                    <div style={{ color: 'var(--text-faint)', fontSize: '0.85em' }}>
                                      Avg {Math.round(p.avgPrice * 100)}{terminalLayout ? '%' : '¢'} · Now {Math.round(p.curPrice * 100)}{terminalLayout ? '%' : '¢'}
                                    </div>
                                  </td>
                                  <td data-label="Result" style={{ color: p.cashPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{p.cashPnl >= 0 ? 'Up' : 'Down'}</td>
                                  <td className="num" data-label="Total Traded">{totalTraded != null ? fmtFull(totalTraded) : '—'}</td>
                                  <td className="num" data-label="Amount">
                                    {amount != null ? fmtFull(amount) : '—'}
                                    <div style={{ color: p.cashPnl >= 0 ? 'var(--green)' : 'var(--red)', fontSize: '0.85em' }}>{fmtSigned(p.cashPnl)}</div>
                                  </td>
                                </tr>
                              )
                            })}
                        </tbody>
                      </table>
                    </div>
                    {!openPositionsLoading && livePositions.length === 0 && (
                      <div className="sig-empty">No active positions right now.</div>
                    )}
                  </>
                )}

                {positionsTab === 'closed' && (
                  <>
                    <div className="sig-table-wrap">
                      <table className="sig-table">
                        <thead>
                          <tr><th>Market</th><th>Result</th><th className="num">Total Traded</th><th className="num">Amount</th></tr>
                        </thead>
                        <tbody>
                          {positionsLoading && <SkelTableRows cols={4} count={10} />}
                          {!positionsLoading && aggregatedPositions
                            .filter(p => !positionsSearch || p.title.toLowerCase().includes(positionsSearch.toLowerCase()))
                            .slice(0, visibleTrades)
                            .map((p, i) => {
                              const amount = p.totalStake + p.totalProfit
                              const returnPct = p.totalStake > 0 ? (p.totalProfit / p.totalStake) * 100 : 0
                              return (
                                <tr key={i}>
                                  <td>
                                    {p.title} <span style={{ color: 'var(--text-dim)' }}>— {p.outcome}</span>
                                    <div style={{ color: 'var(--text-faint)', fontSize: '0.85em' }}>
                                      Avg {Math.round(p.avgPrice * 100)}{terminalLayout ? '%' : '¢'}{p.fills > 1 ? ` · ${p.fills} fills` : ''} · {timeAgo(p.latestResolvedTs)}
                                    </div>
                                  </td>
                                  <td data-label="Result" style={{ color: p.resolvedWin ? 'var(--green)' : 'var(--red)' }}>{p.resolvedWin ? 'Won' : 'Lost'}</td>
                                  <td className="num" data-label="Total Traded">{fmtFull(p.totalStake)}</td>
                                  <td className="num" data-label="Amount">
                                    {fmtFull(amount)}
                                    <div style={{ color: p.totalProfit >= 0 ? 'var(--green)' : 'var(--red)', fontSize: '0.85em' }}>
                                      {fmtSigned(p.totalProfit)} ({returnPct >= 0 ? '+' : ''}{returnPct.toFixed(1)}%)
                                    </div>
                                  </td>
                                </tr>
                              )
                            })}
                        </tbody>
                      </table>
                    </div>
                    {!positionsLoading && aggregatedPositions.length > visibleTrades && (
                      <button className="sig-load-more" onClick={() => setVisibleTrades(v => v + PAGE_STEP)}>
                        Load more ({aggregatedPositions.length - visibleTrades} remaining)
                      </button>
                    )}
                    {!positionsLoading && visibleTrades > 10 && aggregatedPositions.length <= visibleTrades && (
                      <button className="sig-load-more" onClick={() => setVisibleTrades(10)}>
                        Show fewer
                      </button>
                    )}
                  </>
                )}
              </div>

              <div className="search-dashboard-side">
                <HighlightsRow
                  items={aggregatedPositions.map(p => ({ title: p.title, outcome: p.outcome, profit: p.totalProfit }))}
                  loading={positionsLoading}
                />
                <CategoryBreakdownSection categoryBreakdown={byCategory} loading={categoryLoading} />
                <div>
                  <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Similar top traders</div>
                  {similarLoading ? (
                    <div className="sig-table-wrap">
                      <table className="sig-table">
                        <thead><tr><th>Trader</th><th className="num">Overlap</th><th className="num">Net P&L</th></tr></thead>
                        <tbody><SkelTableRows cols={3} count={5} /></tbody>
                      </table>
                    </div>
                  ) : (
                    <SimilarTradersTable
                      similarTraders={similarTraders} linkFor={linkToTrader}
                      trackedWallets={trackedWallets} busyWallet={busyWallet} onTrack={trackWallet} onUntrack={untrackWallet}
                      loggedIn={true}
                    />
                  )}
                </div>
              </div>
            </div>
          </>
        )}

        {!summaryLoading && !error && !summary && (
          <>
            <div className="sig-empty" style={{ marginBottom: 20 }}>
              Not in our tracked history yet — showing live data straight from Polymarket instead.
            </div>

            {liveLoading && (
              <>
                <SkelStatsRow count={4} />
                <div className="sig-table-wrap">
                  <table className="sig-table">
                    <thead>
                      <tr><th>Market</th><th className="num">Avg Price</th><th className="num">Current Price</th><th className="num">Unrealized P&L</th></tr>
                    </thead>
                    <tbody>
                      <SkelTableRows cols={4} count={6} />
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {!liveLoading && (livePositions.length > 0 || liveClosed.length > 0) && (
              <>
                <div className="sig-stats-row" style={{ marginBottom: 24 }}>
                  <div className="sig-stat-cell">
                    <div className="sig-stat-cell-label">Realized P&L</div>
                    <div className={`sig-stat-cell-val ${liveRealizedPnl >= 0 ? 'g' : 'r'}`}>{fmtSigned(liveRealizedPnl)}</div>
                  </div>
                  <div className="sig-stat-cell">
                    <div className="sig-stat-cell-label" title="Winning closed positions ÷ total closed positions">Win Rate</div>
                    <div className="sig-stat-cell-val">{liveWinRate.toFixed(0)}%</div>
                  </div>
                  <div className="sig-stat-cell">
                    <div className="sig-stat-cell-label">Current Positions</div>
                    <div className="sig-stat-cell-val">{livePositions.length}</div>
                  </div>
                  <div className="sig-stat-cell">
                    <div className="sig-stat-cell-label">Total Positions</div>
                    <div className="sig-stat-cell-val">{livePositions.length + liveClosed.length}</div>
                  </div>
                </div>

                <div className="search-dashboard-grid">
                  <div className="search-dashboard-main">
                    <CumulativeChartSection data={liveCumulative} label="Realized P&L over time (live from Polymarket)" height={chartHeight} />

                    {livePositions.length > 0 && (
                      <>
                        <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Current positions (live from Polymarket)</div>
                        <div className="sig-table-wrap" style={{ marginBottom: 24 }}>
                          <table className="sig-table">
                            <thead>
                              <tr><th>Market</th><th className="num">Avg Price</th><th className="num">Current Price</th><th className="num">Unrealized P&L</th></tr>
                            </thead>
                            <tbody>
                              {livePositions.map((p, i) => (
                                <tr key={i}>
                                  <td>{p.title} <span style={{ color: 'var(--text-dim)' }}>— {p.outcome}</span></td>
                                  <td className="num" data-label="Avg Price">{Math.round(p.avgPrice * 100)}{terminalLayout ? '%' : '¢'}</td>
                                  <td className="num" data-label="Current Price">{Math.round(p.curPrice * 100)}{terminalLayout ? '%' : '¢'}</td>
                                  <td className="num" data-label="Unrealized P&L" style={{ color: p.cashPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(p.cashPnl)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}

                    {sortedLiveClosed.length > 0 && (
                      <>
                        <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Closed positions (live from Polymarket)</div>
                        <div className="sig-table-wrap" style={{ marginBottom: 24 }}>
                          <table className="sig-table">
                            <thead>
                              <tr><th>Market</th><th>Result</th><th className="num">Profit</th><th className="num">Resolved</th></tr>
                            </thead>
                            <tbody>
                              {sortedLiveClosed.slice(0, visibleLive).map((p, i) => (
                                <tr key={i}>
                                  <td>{p.title} <span style={{ color: 'var(--text-dim)' }}>— {p.outcome}</span></td>
                                  <td data-label="Result" style={{ color: p.curPrice >= 0.5 ? 'var(--green)' : 'var(--red)' }}>{p.curPrice >= 0.5 ? 'Won' : 'Lost'}</td>
                                  <td className="num" data-label="Profit" style={{ color: p.realizedPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(p.realizedPnl)}</td>
                                  <td className="num" data-label="Resolved" style={{ color: 'var(--text-dim)' }}>{timeAgo(new Date(p.timestamp * 1000).toISOString())}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {sortedLiveClosed.length > visibleLive && (
                            <button className="sig-load-more" onClick={() => setVisibleLive(v => v + PAGE_STEP)}>
                              Load more ({sortedLiveClosed.length - visibleLive} remaining)
                            </button>
                          )}
                          {visibleLive > 10 && sortedLiveClosed.length <= visibleLive && (
                            <button className="sig-load-more" onClick={() => setVisibleLive(10)}>
                              Show fewer
                            </button>
                          )}
                        </div>
                      </>
                    )}

                    {liveTrades.length > 0 && (
                      <>
                        <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Recent trades (live from Polymarket)</div>
                        <div className="sig-table-wrap">
                          <table className="sig-table">
                            <thead>
                              <tr><th>Market</th><th>Side</th><th className="num">Size</th><th className="num">Price</th><th className="num">When</th></tr>
                            </thead>
                            <tbody>
                              {liveTrades.map((t, i) => (
                                <tr key={i}>
                                  <td>{t.title} <span style={{ color: 'var(--text-dim)' }}>— {t.outcome}</span></td>
                                  <td data-label="Side" style={{ color: t.side === 'BUY' ? 'var(--green)' : 'var(--red)' }}>{t.side}</td>
                                  <td className="num" data-label="Size">{t.size.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                                  <td className="num" data-label="Price">{Math.round(t.price * 100)}{terminalLayout ? '%' : '¢'}</td>
                                  <td className="num" data-label="When" style={{ color: 'var(--text-dim)' }}>{timeAgo(new Date(t.timestamp * 1000).toISOString())}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="search-dashboard-side">
                    <HighlightsRow items={sortedLiveClosed.map(p => ({ title: p.title, outcome: p.outcome, profit: p.realizedPnl }))} />
                    <div>
                      <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Similar top traders</div>
                      <SimilarTradersTable
                        similarTraders={similarTraders} linkFor={linkToTrader}
                        trackedWallets={trackedWallets} busyWallet={busyWallet} onTrack={trackWallet} onUntrack={untrackWallet}
                        loggedIn={true}
                      />
                    </div>
                  </div>
                </div>
              </>
            )}

            {!liveLoading && livePositions.length === 0 && liveClosed.length === 0 && liveTrades.length === 0 && (
              <div className="sig-empty">Nothing found for this wallet on Polymarket either.</div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default TraderDetailPage
