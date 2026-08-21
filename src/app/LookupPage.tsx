import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import posthog from '../lib/posthog'
import { dashboardPath } from '../lib/domains'
import { traderLabel, profileUrl, fmtFull } from './helpers'
import { SkelTableRows } from './Skeleton'

/* ── Lookup ── */
interface DirectoryResult {
  wallet: string
  username: string | null
  best_pnl: number | null
}

interface LookupStatus {
  manuallyTracked: boolean
  pnlRank: number | null
}

function LookupPage() {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DirectoryResult[]>([])
  const [status, setStatus] = useState<Record<string, LookupStatus>>({})
  const [rosterSize, setRosterSize] = useState(500)
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyWallet, setBusyWallet] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
    Promise.resolve(supabase.from('app_settings').select('roster_size').eq('id', 1).single())
      .then(({ data }) => { if (data) setRosterSize((data as { roster_size: number }).roster_size) })
      .catch(() => {})
  }, [])

  const loadStatus = (wallets: string[]) => {
    Promise.all([
      Promise.resolve(supabase.from('tracked_wallets').select('wallet').in('wallet', wallets)),
      Promise.all(wallets.map(w => Promise.resolve(supabase.rpc('wallet_pnl_rank', { target_wallet: w })))),
    ]).then(([trackedRes, rankResults]) => {
      const trackedSet = new Set(((trackedRes.data ?? []) as { wallet: string }[]).map(r => r.wallet))
      const next: Record<string, LookupStatus> = {}
      wallets.forEach((w, i) => {
        const rank = rankResults[i]?.data as number | null
        next[w] = { manuallyTracked: trackedSet.has(w), pnlRank: rank ?? null }
      })
      setStatus(next)
    }).catch(() => {})
  }

  const search = () => {
    const q = query.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    Promise.resolve(
      supabase.from('wallet_directory').select('wallet, username, best_pnl')
        .or(`wallet.ilike.%${q}%,username.ilike.%${q}%`)
        .order('best_pnl', { ascending: false })
        .limit(20)
    )
      .then(({ data, error: err }) => {
        if (err) throw err
        const rows = (data ?? []) as DirectoryResult[]
        setResults(rows)
        setLoading(false)
        posthog.capture('wallet_search_completed', { result_count: rows.length })
        if (rows.length > 0) loadStatus(rows.map(r => r.wallet))
      })
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }

  const track = (wallet: string) => {
    setBusyWallet(wallet)
    Promise.resolve(
      supabase.from('tracked_wallets').upsert(
        { wallet, added_by: userId },
        { onConflict: 'wallet', ignoreDuplicates: true }
      )
    )
      .then(({ error: err }) => {
        if (err) throw err
        setStatus(s => ({ ...s, [wallet]: { ...s[wallet], manuallyTracked: true } }))
        posthog.capture('wallet_tracking_added')
      })
      .catch(() => {})
      .finally(() => setBusyWallet(null))
  }

  const untrack = (wallet: string) => {
    setBusyWallet(wallet)
    Promise.resolve(supabase.from('tracked_wallets').delete().eq('wallet', wallet))
      .then(({ error: err }) => {
        if (err) throw err
        setStatus(s => ({ ...s, [wallet]: { ...s[wallet], manuallyTracked: false } }))
        posthog.capture('wallet_tracking_removed')
      })
      .catch(() => {})
      .finally(() => setBusyWallet(null))
  }

  return (
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Lookup</h1>
          <p className="app-section-sub">Search any wallet by address or username — track one that isn't already tracked</p>
        </div>
      </div>

      <div className="sig-panel">
        <div className="sig-watch-form" style={{ marginBottom: 20 }}>
          <input
            className="sig-watch-input"
            placeholder="Wallet address or username…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
          />
          <button className="sig-btn" onClick={search} disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
        </div>

        {error && <div style={{ color: '#ff3b5c', marginBottom: 20, fontSize: '0.875rem' }}>{error}</div>}
        {!loading && !error && results.length === 0 && <div className="sig-empty">No results yet — search above.</div>}

        {(loading || results.length > 0) && (
          <div className="sig-table-wrap">
            <table className="sig-table">
              <thead>
                <tr>
                  <th>Trader</th>
                  <th className="num">Best PnL</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {loading && <SkelTableRows cols={4} count={5} />}
                {!loading && results.map(r => {
                  const s = status[r.wallet]
                  const inRoster = s && s.pnlRank !== null && s.pnlRank <= rosterSize
                  const tracked = inRoster || s?.manuallyTracked
                  return (
                    <tr key={r.wallet}>
                      <td>
                        <a href="#" onClick={e => { e.preventDefault(); navigate(dashboardPath(`/trader/${r.wallet}`)) }}>
                          {traderLabel(r.wallet, r.username)}
                        </a>
                        <a
                          href={profileUrl(r.wallet)!} target="_blank" rel="noopener noreferrer"
                          style={{ marginLeft: 6, color: 'var(--text-faint)', fontSize: 11 }}
                        >
                          ↗
                        </a>
                      </td>
                      <td className="num" data-label="Best PnL">{r.best_pnl != null ? fmtFull(r.best_pnl) : '—'}</td>
                      <td data-label="Status">
                        {!s ? '…' :
                          inRoster ? `Tracked · top ${s.pnlRank} by PnL` :
                          s.manuallyTracked ? 'Tracked · manually added' :
                          'Not tracked'}
                      </td>
                      <td>
                        {s && !tracked && (
                          userId ? (
                            <button className="sig-btn" disabled={busyWallet === r.wallet} onClick={() => track(r.wallet)}>
                              {busyWallet === r.wallet ? 'Adding…' : 'Track'}
                            </button>
                          ) : (
                            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Log in to track</span>
                          )
                        )}
                        {s && s.manuallyTracked && userId && (
                          <span className="sig-watch-remove" onClick={() => untrack(r.wallet)}>Untrack</span>
                        )}
                      </td>
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

export default LookupPage
