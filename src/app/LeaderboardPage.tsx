import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { dashboardPath } from '../lib/domains'
import { onTabVisible, traderLabel, profileUrl, fmtFull, fmtSigned, avatarGradient, avatarInitial } from './helpers'
import { SkelBlock } from './Skeleton'

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

function SkelLeaderboardRow() {
  return (
    <div className="lb-row">
      <div className="lb-trader">
        <SkelBlock width={18} height={12} />
        <div className="sig-skel" style={{ width: 40, height: 40, borderRadius: '50%', flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <SkelBlock height={14} width="65%" style={{ marginBottom: 6 }} />
          <SkelBlock height={11} width="35%" />
        </div>
      </div>
      {[0, 1, 2].map(i => (
        <div className="lb-col" key={i}>
          <div className="lb-col-stack">
            <SkelBlock height={14} width={70} style={{ marginLeft: 'auto', marginBottom: 6 }} />
            <SkelBlock height={11} width={50} style={{ marginLeft: 'auto' }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function LeaderboardPage() {
  const navigate = useNavigate()
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
          <div className="lb-table">
            <div className="lb-head">
              <div>Trader</div>
              <div className="lb-col">Deployed</div>
              <div className="lb-col">PnL</div>
              <div className="lb-col">Win rate</div>
            </div>

            {loading && Array.from({ length: 10 }).map((_, i) => <SkelLeaderboardRow key={i} />)}

            {!loading && rows.map((r, i) => {
              const winRate = r.won + r.lost > 0 ? (r.won / (r.won + r.lost)) * 100 : 0
              const usdWinRate = r.deployed > 0 ? (r.won_usd / r.deployed) * 100 : 0
              const roi = r.deployed > 0 ? (r.net_profit / r.deployed) * 100 : 0
              const profitable = r.net_profit >= 0
              const initial = avatarInitial(r.wallet, r.wallet_name)
              return (
                <div className="lb-row" key={r.wallet}>
                  <div className="lb-trader">
                    <span className="lb-rank">{i + 1}</span>
                    <div className="lb-avatar" style={{ background: avatarGradient(r.wallet) }}>{initial}</div>
                    <div style={{ minWidth: 0 }}>
                      <a
                        href="#" className="lb-name"
                        onClick={e => { e.preventDefault(); navigate(dashboardPath(`/trader/${r.wallet}`)) }}
                      >
                        {traderLabel(r.wallet, r.wallet_name)}
                      </a>
                      <div className="lb-sub">
                        {r.n} trades ·{' '}
                        <a href={profileUrl(r.wallet)!} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
                          view ↗
                        </a>
                      </div>
                    </div>
                  </div>

                  <div className="lb-col" data-label="Deployed">
                    <div className="lb-col-stack">
                      <div className="lb-val">{fmtFull(r.deployed)}</div>
                      <div className="lb-val-sub" style={{ color: 'var(--text-faint)' }}>{winRate.toFixed(0)}% win rate</div>
                    </div>
                  </div>

                  <div className="lb-col" data-label="PnL">
                    <div className="lb-col-stack">
                      <div className={`lb-val ${profitable ? 'g' : 'r'}`}>{fmtSigned(r.net_profit)}</div>
                      <div className="lb-val-sub" style={{ color: profitable ? 'var(--green)' : 'var(--red)' }}>
                        {profitable ? '▲' : '▼'} {Math.abs(roi).toFixed(1)}%
                      </div>
                    </div>
                  </div>

                  <div className="lb-col" data-label="Win rate">
                    <div className="lb-col-stack">
                      <div className="lb-val">{usdWinRate.toFixed(0)}<span className="lb-val-suffix">% $-wtd</span></div>
                      <div className="lb-val-sub" style={{ color: 'var(--text-faint)' }}>{r.won}/{r.won + r.lost} resolved</div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

export default LeaderboardPage
