import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { dashboardPath } from '../lib/domains'
import { traderLabel, fmtSigned, fmtFull, timeAgo, addToWatchedWallets, removeFromWatchedWallets } from './helpers'
import { SkelStatsRow, SkelTableRows } from './Skeleton'
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

function TraderDetailPage({ wallet, linkToTrader = w => dashboardPath(`/trader/${w}`), chartHeight = 220 }: {
  wallet: string
  // Overridable so the Terminal (its own self-contained route tree, see
  // src/app/terminal/) can keep "jump to another wallet"/similar-traders
  // navigation inside itself instead of bouncing out to the main app's
  // /trader/:wallet route, which is what dashboardPath always points to.
  linkToTrader?: (wallet: string) => string
  // Same reasoning as MarketDetailContent's identical prop — the Terminal
  // has a full page to work with, so it passes a taller value here too.
  chartHeight?: number
}) {
  const [summary, setSummary] = useState<TraderSummary | null>(null)
  const [positions, setPositions] = useState<TraderPosition[]>([])
  const [byCategory, setByCategory] = useState<CategoryRow[]>([])
  const [similarTraders, setSimilarTraders] = useState<SimilarTrader[]>([])
  const [loading, setLoading] = useState(true)
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
    Promise.all([
      supabase.from('leaderboard').select('*').ilike('wallet', wallet).maybeSingle(),
      supabase.from('wallet_positions').select('*').ilike('wallet', wallet).eq('market_closed', true).order('resolved_ts', { ascending: false }),
      supabase.from('wallet_category_breakdown').select('*').ilike('wallet', wallet).order('profit', { ascending: false }),
    ])
      .then(([summaryRes, positionsRes, categoryRes]) => {
        if (cancelled) return
        if (summaryRes.error) throw summaryRes.error
        if (positionsRes.error) throw positionsRes.error
        if (categoryRes.error) throw categoryRes.error
        const summaryData = (summaryRes.data ?? null) as TraderSummary | null
        const positionsData = (positionsRes.data ?? []) as TraderPosition[]
        setSummary(summaryData)
        setPositions(positionsData)
        setByCategory((categoryRes.data ?? []) as CategoryRow[])
        setLoading(false)
        setError(null)
        loadTrackedStatus([wallet])

        if (summaryData) {
          findSimilarTraders(positionsData, wallet).then(st => {
            if (cancelled) return
            setSimilarTraders(st)
            loadTrackedStatus(st.map(t => t.wallet))
          }).catch(() => {})
        } else {
          // We only have history for wallets we've tracked ourselves — for
          // everyone else, fall back to Polymarket's own public (CORS-open,
          // no auth needed) data API so "no tracked history" doesn't mean
          // "we can't show you anything real about this wallet."
          setLiveLoading(true)
          Promise.all([
            fetch(`https://data-api.polymarket.com/positions?user=${wallet}&limit=50`).then(r => r.ok ? r.json() : []),
            fetch(`https://data-api.polymarket.com/closed-positions?user=${wallet}&limit=200`).then(r => r.ok ? r.json() : []),
            fetch(`https://data-api.polymarket.com/trades?user=${wallet}&limit=30`).then(r => r.ok ? r.json() : []),
          ])
            .then(([pos, closed, trades]) => {
              if (cancelled) return
              const livePos = (pos ?? []) as LivePosition[]
              const liveClosedPos = (closed ?? []) as LiveClosedPosition[]
              setLivePositions(livePos)
              setLiveClosed(liveClosedPos)
              setLiveTrades((trades ?? []) as LiveTrade[])
              const pairs = [...livePos, ...liveClosedPos]
                .filter(p => p.conditionId && p.outcome)
                .map(p => ({ condition_id: p.conditionId, outcome: p.outcome }))
              findSimilarTraders(pairs, wallet).then(st => {
                if (cancelled) return
                setSimilarTraders(st)
                loadTrackedStatus(st.map(t => t.wallet))
              }).catch(() => {})
            })
            .catch(() => {})
            .finally(() => { if (!cancelled) setLiveLoading(false) })
        }
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [wallet, loadTrackedStatus])

  const winRate = summary && summary.won + summary.lost > 0 ? (summary.won / (summary.won + summary.lost)) * 100 : 0
  const usdWinRate = summary && summary.deployed > 0 ? (summary.won_usd / summary.deployed) * 100 : 0
  const roi = summary && summary.deployed > 0 ? (summary.net_profit / summary.deployed) * 100 : 0

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
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">{traderLabel(wallet, summary?.wallet_name ?? null)}</h1>
          <p className="app-section-sub">
            {loading ? 'Loading…' : error ? 'Connection trouble — retrying…' : (
              trackedWallets[wallet] ? (
                <span className="sig-watch-remove" style={{ display: 'inline' }} onClick={() => untrackWallet(wallet)}>
                  {busyWallet === wallet ? 'Removing…' : 'Unfollow'}
                </span>
              ) : (
                <span style={{ cursor: 'pointer', color: 'var(--blue)' }} onClick={() => trackWallet(wallet)}>
                  {busyWallet === wallet ? 'Adding…' : '+ Follow this trader'}
                </span>
              )
            )}
          </p>
        </div>
      </div>

      <div className="sig-panel">
        {error && (
          <div style={{ color: '#ff3b5c', padding: '0 0 20px', fontSize: '0.875rem' }}>{error}</div>
        )}

        {loading && !error && (
          <>
            <SkelStatsRow count={5} />
            <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>All resolved positions</div>
            <div className="sig-table-wrap">
              <table className="sig-table">
                <thead>
                  <tr><th>Market</th><th className="num">Stake</th><th className="num">Price</th><th>Result</th><th className="num">Profit</th><th className="num">Resolved</th></tr>
                </thead>
                <tbody>
                  <SkelTableRows cols={6} count={8} />
                </tbody>
              </table>
            </div>
          </>
        )}

        {!loading && !error && summary && (
          <>
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

            <div className="search-dashboard-grid">
              <div className="search-dashboard-main">
                <CumulativeChartSection data={trackedCumulative} label="P&L over time" height={chartHeight} />

                <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>All resolved positions</div>
                <div className="sig-table-wrap">
                  <table className="sig-table">
                    <thead>
                      <tr><th>Market</th><th className="num">Stake</th><th className="num">Price</th><th>Result</th><th className="num">Profit</th><th className="num">Resolved</th></tr>
                    </thead>
                    <tbody>
                      {positions.slice(0, visibleTrades).map((p, i) => (
                        <tr key={i}>
                          <td>{p.title} <span style={{ color: 'var(--text-dim)' }}>— {p.outcome}</span></td>
                          <td className="num" data-label="Stake">{fmtFull(p.usd)}</td>
                          <td className="num" data-label="Price">{Math.round(p.price * 100)}¢</td>
                          <td data-label="Result" style={{ color: p.resolved_win ? 'var(--green)' : 'var(--red)' }}>{p.resolved_win ? 'Won' : 'Lost'}</td>
                          <td className="num" data-label="Profit" style={{ color: p.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(p.profit)}</td>
                          <td className="num" data-label="Resolved" style={{ color: 'var(--text-dim)' }}>{timeAgo(p.resolved_ts)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {positions.length > visibleTrades && (
                    <button className="sig-load-more" onClick={() => setVisibleTrades(v => v + PAGE_STEP)}>
                      Load more ({positions.length - visibleTrades} remaining)
                    </button>
                  )}
                  {visibleTrades > 10 && positions.length <= visibleTrades && (
                    <button className="sig-load-more" onClick={() => setVisibleTrades(10)}>
                      Show fewer
                    </button>
                  )}
                </div>
              </div>

              <div className="search-dashboard-side">
                <HighlightsRow items={positions} />
                <CategoryBreakdownSection categoryBreakdown={byCategory} />
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

        {!loading && !error && !summary && (
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
                                  <td className="num" data-label="Avg Price">{Math.round(p.avgPrice * 100)}¢</td>
                                  <td className="num" data-label="Current Price">{Math.round(p.curPrice * 100)}¢</td>
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
                                  <td className="num" data-label="Price">{Math.round(t.price * 100)}¢</td>
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
