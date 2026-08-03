import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { traderLabel, profileUrl, categoryLabel, fmtSigned, fmtFull, timeAgo } from './helpers'
import { CumulativeChart } from './PriceChart'

/* ── Trader detail ── */
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
  usd: number
  price: number
  resolved_win: boolean
  resolved_ts: string
  profit: number
}

interface TraderCategoryStat {
  category: string
  n: number
  won: number
  lost: number
  profit: number
}

interface LivePosition {
  title: string
  outcome: string
  curPrice: number
  avgPrice: number
  cashPnl: number
  realizedPnl: number
  redeemable: boolean
}

interface LiveClosedPosition {
  title: string
  outcome: string
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

function TraderDetailPage({ wallet, onBack }: { wallet: string; onBack: () => void }) {
  const [summary, setSummary] = useState<TraderSummary | null>(null)
  const [positions, setPositions] = useState<TraderPosition[]>([])
  const [byCategory, setByCategory] = useState<TraderCategoryStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [livePositions, setLivePositions] = useState<LivePosition[]>([])
  const [liveClosed, setLiveClosed] = useState<LiveClosedPosition[]>([])
  const [liveTrades, setLiveTrades] = useState<LiveTrade[]>([])
  const [liveLoading, setLiveLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLivePositions([])
    setLiveClosed([])
    setLiveTrades([])
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
        setSummary(summaryData)
        setPositions((positionsRes.data ?? []) as TraderPosition[])
        setByCategory((categoryRes.data ?? []) as TraderCategoryStat[])
        setLoading(false)
        setError(null)

        // We only have history for wallets we've tracked ourselves — for
        // everyone else, fall back to Polymarket's own public (CORS-open,
        // no auth needed) data API so "no tracked history" doesn't mean
        // "we can't show you anything real about this wallet."
        if (!summaryData) {
          setLiveLoading(true)
          Promise.all([
            fetch(`https://data-api.polymarket.com/positions?user=${wallet}&limit=50`).then(r => r.ok ? r.json() : []),
            fetch(`https://data-api.polymarket.com/closed-positions?user=${wallet}&limit=200`).then(r => r.ok ? r.json() : []),
            fetch(`https://data-api.polymarket.com/trades?user=${wallet}&limit=30`).then(r => r.ok ? r.json() : []),
          ])
            .then(([pos, closed, trades]) => {
              if (cancelled) return
              setLivePositions((pos ?? []) as LivePosition[])
              setLiveClosed((closed ?? []) as LiveClosedPosition[])
              setLiveTrades((trades ?? []) as LiveTrade[])
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
  }, [wallet])

  const winRate = summary && summary.won + summary.lost > 0 ? (summary.won / (summary.won + summary.lost)) * 100 : 0
  const usdWinRate = summary && summary.deployed > 0 ? (summary.won_usd / summary.deployed) * 100 : 0
  const roi = summary && summary.deployed > 0 ? (summary.net_profit / summary.deployed) * 100 : 0

  // Live-fallback stats, computed the same way check_market_closed already
  // does server-side: a resolved outcome settles at 0 or 1, so curPrice >= 0.5
  // means that side won.
  const liveWon = liveClosed.filter(p => p.curPrice >= 0.5).length
  const liveWinRate = liveClosed.length > 0 ? (liveWon / liveClosed.length) * 100 : 0
  const liveRealizedPnl = liveClosed.reduce((sum, p) => sum + p.realizedPnl, 0)
  const liveCumulative = [...liveClosed]
    .sort((a, b) => a.timestamp - b.timestamp)
    .reduce<{ d: string; cum: number }[]>((acc, p) => {
      const prevCum = acc.length > 0 ? acc[acc.length - 1].cum : 0
      acc.push({ d: String(p.timestamp), cum: prevCum + p.realizedPnl })
      return acc
    }, [])

  return (
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <button className="sig-btn secondary" onClick={onBack} style={{ marginBottom: 12 }}>← Back to Leaderboard</button>
          <h1 className="app-section-title">{traderLabel(wallet, summary?.wallet_name ?? null)}</h1>
          <p className="app-section-sub">
            {loading ? 'Loading…' : error ? 'Could not reach the signals backend' : (
              <a href={profileUrl(wallet)!} target="_blank" rel="noopener noreferrer">View on Polymarket ↗</a>
            )}
          </p>
        </div>
      </div>

      <div className="sig-panel">
        {error && (
          <div style={{ color: '#ff3b5c', padding: '0 0 20px', fontSize: '0.875rem' }}>{error}</div>
        )}

        {!loading && !error && summary && (
          <>
            <div className="sig-stats-row">
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

            {byCategory.length > 0 && (
              <>
                <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>By category</div>
                <div className="sig-table-wrap" style={{ marginBottom: 24 }}>
                  <table className="sig-table">
                    <thead>
                      <tr><th>Category</th><th className="num">Trades</th><th className="num">Win Rate</th><th className="num">Profit</th></tr>
                    </thead>
                    <tbody>
                      {byCategory.map(c => {
                        const cwr = c.won + c.lost > 0 ? (c.won / (c.won + c.lost)) * 100 : 0
                        return (
                          <tr key={c.category}>
                            <td>{categoryLabel(c.category)}</td>
                            <td className="num">{c.n}</td>
                            <td className="num">{cwr.toFixed(0)}%</td>
                            <td className="num" style={{ color: c.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(c.profit)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>All resolved positions</div>
            <div className="sig-table-wrap">
              <table className="sig-table">
                <thead>
                  <tr><th>Market</th><th className="num">Stake</th><th className="num">Price</th><th>Result</th><th className="num">Profit</th><th className="num">Resolved</th></tr>
                </thead>
                <tbody>
                  {positions.map((p, i) => (
                    <tr key={i}>
                      <td>{p.title} <span style={{ color: 'var(--text-dim)' }}>— {p.outcome}</span></td>
                      <td className="num">{fmtFull(p.usd)}</td>
                      <td className="num">{Math.round(p.price * 100)}¢</td>
                      <td style={{ color: p.resolved_win ? 'var(--green)' : 'var(--red)' }}>{p.resolved_win ? 'Won' : 'Lost'}</td>
                      <td className="num" style={{ color: p.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(p.profit)}</td>
                      <td className="num" style={{ color: 'var(--text-dim)' }}>{timeAgo(p.resolved_ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!loading && !error && !summary && (
          <>
            <div className="sig-empty" style={{ marginBottom: 20 }}>
              Not in our tracked history yet — showing live data straight from Polymarket instead.
            </div>

            {liveLoading && <div className="sig-empty">Loading from Polymarket…</div>}

            {!liveLoading && (livePositions.length > 0 || liveClosed.length > 0) && (
              <>
                <div className="sig-stats-row">
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

                {liveCumulative.length > 1 && (
                  <>
                    <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Realized P&L over time (live from Polymarket)</div>
                    <div style={{ marginBottom: 24 }}>
                      <CumulativeChart data={liveCumulative} />
                    </div>
                  </>
                )}
              </>
            )}

            {!liveLoading && livePositions.length > 0 && (
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
                          <td className="num">{Math.round(p.avgPrice * 100)}¢</td>
                          <td className="num">{Math.round(p.curPrice * 100)}¢</td>
                          <td className="num" style={{ color: p.cashPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(p.cashPnl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {!liveLoading && liveClosed.length > 0 && (
              <>
                <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Closed positions (live from Polymarket)</div>
                <div className="sig-table-wrap" style={{ marginBottom: 24 }}>
                  <table className="sig-table">
                    <thead>
                      <tr><th>Market</th><th>Result</th><th className="num">Profit</th><th className="num">Resolved</th></tr>
                    </thead>
                    <tbody>
                      {[...liveClosed].sort((a, b) => b.timestamp - a.timestamp).map((p, i) => (
                        <tr key={i}>
                          <td>{p.title} <span style={{ color: 'var(--text-dim)' }}>— {p.outcome}</span></td>
                          <td style={{ color: p.curPrice >= 0.5 ? 'var(--green)' : 'var(--red)' }}>{p.curPrice >= 0.5 ? 'Won' : 'Lost'}</td>
                          <td className="num" style={{ color: p.realizedPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(p.realizedPnl)}</td>
                          <td className="num" style={{ color: 'var(--text-dim)' }}>{timeAgo(new Date(p.timestamp * 1000).toISOString())}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {!liveLoading && liveTrades.length > 0 && (
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
                          <td style={{ color: t.side === 'BUY' ? 'var(--green)' : 'var(--red)' }}>{t.side}</td>
                          <td className="num">{t.size.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td className="num">{Math.round(t.price * 100)}¢</td>
                          <td className="num" style={{ color: 'var(--text-dim)' }}>{timeAgo(new Date(t.timestamp * 1000).toISOString())}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
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
