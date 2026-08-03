import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { onTabVisible, traderLabel, profileUrl, fmtFull, fmtSigned } from './helpers'
import { SkelTableRows } from './Skeleton'

/* ── Leaderboard ── */
interface LeaderboardRow {
  wallet: string
  wallet_name: string | null
  n: number
  won: number
  lost: number
  deployed: number
  won_usd: number
  net_profit: number
}

function LeaderboardPage({ onSelectWallet }: { onSelectWallet: (wallet: string) => void }) {
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      Promise.resolve(supabase.from('leaderboard').select('*').order('net_profit', { ascending: false }))
        .then(({ data, error }) => {
          if (cancelled) return
          if (error) throw error
          setRows((data ?? []) as LeaderboardRow[])
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

  return (
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Leaderboard</h1>
          <p className="app-section-sub">
            {loading ? 'Loading…'
              : error ? 'Could not reach the signals backend'
              : "Real observed performance per tracked wallet — not their claimed Polymarket PnL"}
          </p>
        </div>
      </div>

      <div className="sig-panel">
        {error && (
          <div style={{ color: '#ff3b5c', padding: '0 0 20px', fontSize: '0.875rem' }}>{error}</div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="sig-empty">No resolved positions yet.</div>
        )}

        {(loading || (!error && rows.length > 0)) && (
          <div className="sig-table-wrap">
            <table className="sig-table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Trader</th>
                  <th className="num">Trades</th>
                  <th className="num" title="Winning trades ÷ total resolved trades">Win Rate (#)</th>
                  <th className="num" title="Dollars in winning trades ÷ total dollars deployed — weights by position size, not trade count">Win Rate ($)</th>
                  <th className="num">Deployed</th>
                  <th className="num">Profit</th>
                  <th className="num">ROI</th>
                </tr>
              </thead>
              <tbody>
                {loading && <SkelTableRows cols={8} count={10} />}
                {!loading && rows.map((r, i) => {
                  const winRate = r.won + r.lost > 0 ? (r.won / (r.won + r.lost)) * 100 : 0
                  const usdWinRate = r.deployed > 0 ? (r.won_usd / r.deployed) * 100 : 0
                  const roi = r.deployed > 0 ? (r.net_profit / r.deployed) * 100 : 0
                  return (
                    <tr key={r.wallet}>
                      <td className="num" style={{ color: 'var(--text-dim)' }}>{i + 1}</td>
                      <td>
                        <a href="#" onClick={e => { e.preventDefault(); onSelectWallet(r.wallet) }}>
                          {traderLabel(r.wallet, r.wallet_name)}
                        </a>
                        <a
                          href={profileUrl(r.wallet)!} target="_blank" rel="noopener noreferrer"
                          style={{ marginLeft: 6, color: 'var(--text-faint)', fontSize: 11 }}
                        >
                          ↗
                        </a>
                      </td>
                      <td className="num">{r.n}</td>
                      <td className="num">{winRate.toFixed(0)}%</td>
                      <td className="num">{usdWinRate.toFixed(0)}%</td>
                      <td className="num">{fmtFull(r.deployed)}</td>
                      <td className="num" style={{ color: r.net_profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(r.net_profit)}</td>
                      <td className="num" style={{ color: roi >= 0 ? 'var(--green)' : 'var(--red)' }}>{roi >= 0 ? '+' : ''}{roi.toFixed(1)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default LeaderboardPage
