import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { onTabVisible, fmtSigned, fmtFull, profileUrl, traderLabel, timeAgo } from './helpers'
import { CumulativeChart } from './PriceChart'

/* ── Profits ── */
interface ProfitsSummary {
  resolved_n: number
  won: number
  lost: number
  deployed: number
  net_profit: number
}

interface ProfitsDaily {
  d: string
  day_profit: number
}

interface ProfitsPosition {
  wallet: string
  wallet_name: string | null
  title: string
  outcome: string
  usd: number
  price: number
  resolved_win: boolean
  resolved_ts: string
  profit: number
}

function ProfitsPage() {
  const [summary, setSummary] = useState<ProfitsSummary | null>(null)
  const [daily, setDaily] = useState<ProfitsDaily[]>([])
  const [positions, setPositions] = useState<ProfitsPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      Promise.all([
        supabase.from('profits_summary').select('*').single(),
        supabase.from('profits_daily').select('*').order('d', { ascending: true }),
        supabase.from('wallet_positions').select('*').eq('market_closed', true).order('resolved_ts', { ascending: false }).limit(200),
      ])
        .then(([summaryRes, dailyRes, positionsRes]) => {
          if (cancelled) return
          if (summaryRes.error) throw summaryRes.error
          if (dailyRes.error) throw dailyRes.error
          if (positionsRes.error) throw positionsRes.error
          setSummary((summaryRes.data ?? null) as ProfitsSummary | null)
          setDaily((dailyRes.data ?? []) as ProfitsDaily[])
          setPositions((positionsRes.data ?? []) as ProfitsPosition[])
          setLoading(false)
          setError(null)
        })
        .catch((e: Error) => {
          if (cancelled) return
          setError(e.message)
          setLoading(false)
        })
    }
    load()
    const interval = setInterval(load, 15000)
    const unsubVisible = onTabVisible(load)
    return () => { cancelled = true; clearInterval(interval); unsubVisible() }
  }, [])

  const winRate = summary && summary.won + summary.lost > 0 ? (summary.won / (summary.won + summary.lost)) * 100 : 0
  const roi = summary && summary.deployed > 0 ? (summary.net_profit / summary.deployed) * 100 : 0

  let running = 0
  const cumulative = daily.map(d => {
    running += d.day_profit
    return { d: d.d, cum: running }
  })

  return (
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Profits</h1>
          <p className="app-section-sub">
            {loading ? 'Loading…'
              : error ? 'Could not reach the signals backend'
              : 'Real resolved P&L from tracked roster positions — payout-adjusted, not just win/loss count'}
          </p>
        </div>
      </div>

      <div className="sig-panel">
        {error && (
          <div style={{ color: '#ff3b5c', padding: '0 0 20px', fontSize: '0.875rem' }}>{error}</div>
        )}

        {!loading && !error && summary && summary.resolved_n > 0 && (
          <>
            <div className="sig-stats-row">
              <div className="sig-stat-cell">
                <div className="sig-stat-cell-label">Net P&L</div>
                <div className={`sig-stat-cell-val ${summary.net_profit >= 0 ? 'g' : 'r'}`}>{fmtSigned(summary.net_profit)}</div>
              </div>
              <div className="sig-stat-cell">
                <div className="sig-stat-cell-label">Win Rate</div>
                <div className="sig-stat-cell-val">{winRate.toFixed(1)}%</div>
              </div>
              <div className="sig-stat-cell">
                <div className="sig-stat-cell-label">ROI</div>
                <div className={`sig-stat-cell-val ${roi >= 0 ? 'g' : 'r'}`}>{roi >= 0 ? '+' : ''}{roi.toFixed(1)}%</div>
              </div>
              <div className="sig-stat-cell">
                <div className="sig-stat-cell-label">Resolved</div>
                <div className="sig-stat-cell-val">{summary.resolved_n}</div>
              </div>
            </div>

            {cumulative.length > 1 && <CumulativeChart data={cumulative} />}

            <div className="sig-table-wrap">
              <table className="sig-table">
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Trader</th>
                    <th className="num">Stake</th>
                    <th className="num">Price</th>
                    <th>Result</th>
                    <th className="num">Profit</th>
                    <th className="num">Resolved</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p, i) => (
                    <tr key={i}>
                      <td>{p.title} <span style={{ color: 'var(--text-dim)' }}>— {p.outcome}</span></td>
                      <td>
                        {p.wallet ? (
                          <a href={profileUrl(p.wallet)!} target="_blank" rel="noopener noreferrer">
                            {traderLabel(p.wallet, p.wallet_name)}
                          </a>
                        ) : '—'}
                      </td>
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

        {!loading && !error && (!summary || summary.resolved_n === 0) && (
          <div className="sig-empty">No resolved positions yet — check back once tracked signals start settling.</div>
        )}
      </div>
    </div>
  )
}

export default ProfitsPage
