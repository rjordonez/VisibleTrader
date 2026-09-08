import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronDown, Plus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { dashboardPath } from '../lib/domains'
import { onTabVisible, traderLabel, fmtSigned, avatarGradient } from './helpers'
import GogglesMark from './GogglesMark'
import type { useAlerts } from './useAlerts'
import './leaderboard.css'

interface LeaderboardRow { wallet: string; wallet_name: string | null; won: number; lost: number; net_profit: number }
type FollowProps = Pick<ReturnType<typeof useAlerts>, 'watchedWallets' | 'addWallet' | 'removeWallet'>
const resolvedCount = (r: LeaderboardRow) => r.won + r.lost
const winRate = (r: LeaderboardRow) => resolvedCount(r) > 0 ? r.won / resolvedCount(r) * 100 : null

function FollowButton({ row, watchedWallets, addWallet, removeWallet }: FollowProps & { row: LeaderboardRow }) {
  const followed = watchedWallets.find(w => w.wallet.toLowerCase() === row.wallet.toLowerCase())
  return <button type="button" className={`leaders-follow ${followed ? 'is-following' : ''}`} aria-pressed={!!followed}
    aria-label={`${followed ? 'Unfollow' : 'Follow'} ${traderLabel(row.wallet, row.wallet_name)}`}
    onClick={() => followed ? removeWallet(followed.wallet) : addWallet(row.wallet)}>
    {followed ? <X size={15} /> : <Plus size={15} />}{followed ? 'Unfollow' : 'Follow'}
  </button>
}

function LeaderboardPage(follow: FollowProps) {
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [ranking, setRanking] = useState<'profit' | 'winrate'>('profit')
  const [minimumTrades, setMinimumTrades] = useState(10)
  useEffect(() => {
    let cancelled = false
    let pending = false
    const load = async () => {
      if (pending) return
      pending = true
      try {
        // Read the compact cache in pages, so win-rate ranking includes traders
        // beyond the top 100 by P&L and isn't truncated by the API row limit.
        const next: LeaderboardRow[] = []
        let cursor: string | undefined
        while (!cancelled) {
          let query = supabase.from('leaderboard').select('wallet,wallet_name,won,lost,net_profit').order('wallet').limit(500)
          if (cursor) query = query.gt('wallet', cursor)
          const { data, error: queryError } = await query
          if (queryError) throw queryError
          const page = (data ?? []) as LeaderboardRow[]
          next.push(...page)
          if (page.length < 500) break
          cursor = page[page.length - 1].wallet
        }
        if (!cancelled) { setRows(next); setError(false); setLoading(false) }
      } catch {
        if (!cancelled) { setError(true); setLoading(false) }
      } finally { pending = false }
    }
    void load()
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60000)
    const unsubscribe = onTabVisible(() => { void load() })
    return () => { cancelled = true; clearInterval(interval); unsubscribe() }
  }, [])

  const eligible = rows.filter(row => resolvedCount(row) >= (ranking === 'winrate' ? minimumTrades : 1))
  const ranked = [...eligible].sort((a, b) => (
    ranking === 'winrate'
      ? (winRate(b)! - winRate(a)!) || resolvedCount(b) - resolvedCount(a) || b.net_profit - a.net_profit
      : b.net_profit - a.net_profit || resolvedCount(b) - resolvedCount(a)
  ) || a.wallet.localeCompare(b.wallet)).slice(0, 100)

  return (
    <div className="sig-page leaders-page">
      <header className="app-section-header leaders-header">
        <div><h1 className="app-section-title">Leaderboard</h1><p className="leaders-period">All tracked history</p></div>
        <div className="leaders-header-controls">
          <label className="leaders-select">
            <select aria-label="Rank traders by" value={ranking} onChange={e => setRanking(e.target.value as typeof ranking)}>
              <option value="profit">Highest P&L</option>
              <option value="winrate">Highest win rate</option>
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </label>
          {ranking === 'winrate' && <label className="leaders-select leaders-minimum">
            <select aria-label="Minimum resolved trades" value={minimumTrades} onChange={e => setMinimumTrades(Number(e.target.value))}>
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}+ resolved trades</option>)}
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </label>}
        </div>
      </header>
      {error && <p className="leaders-notice" role="status">Unable to refresh rankings. {rows.length > 0 ? 'Showing the last available data. ' : ''}Retrying automatically.</p>}
      <section className="leaders-podium" aria-label="Top three traders" aria-busy={loading}>
        {loading ? [0, 1, 2].map(i => <div className="leaders-podium-skeleton sig-skel" key={i} aria-hidden="true" />) : ranked.slice(0, 3).map((row, index) => (
          <article className={`leaders-card leaders-place-${index + 1}`} key={row.wallet}>
            <div className="leaders-card-top"><span className="leaders-place">#{index + 1}</span><Link to={dashboardPath(`/trader/${row.wallet}`)} aria-label={`View ${traderLabel(row.wallet, row.wallet_name)}`}><ArrowUpRight size={18} /></Link></div>
            <Link className="leaders-card-person" to={dashboardPath(`/trader/${row.wallet}`)}><span className="leaders-avatar" style={{ background: avatarGradient(row.wallet) }}><GogglesMark /></span><h2>{traderLabel(row.wallet, row.wallet_name)}</h2></Link>
            <strong className={`leaders-card-profit ${row.net_profit >= 0 ? 'is-positive' : 'is-negative'}`}>{fmtSigned(row.net_profit)}</strong><span className="leaders-metric-label">Resolved P&L</span>
            <div className="leaders-card-record"><strong>{winRate(row)?.toFixed(0)}% <span>win rate</span></strong><span>{resolvedCount(row).toLocaleString()} resolved</span></div>
            <FollowButton row={row} {...follow} />
          </article>
        ))}
      </section>
      <section className="leaders-list" aria-labelledby="leaders-list-title" aria-busy={loading}>
        <div className="leaders-list-heading"><h2 id="leaders-list-title">The rankings</h2>{!loading && <span>{ranked.length} of {eligible.length.toLocaleString()} eligible traders</span>}</div>
        <div className="leaders-column-head" aria-hidden="true"><span>Trader</span><span>Resolved P&L</span><span>Win rate</span><span /></div>
        {loading ? [0, 1, 2, 3, 4].map(i => <div key={i} className="leaders-row-skeleton sig-skel" aria-hidden="true" />) : <ol className="leaders-rows">{ranked.map((row, index) => (
          <li className="leaders-row" key={row.wallet}>
            <div className="leaders-person"><span className="leaders-rank">{index + 1}</span><Link to={dashboardPath(`/trader/${row.wallet}`)}><span className="leaders-avatar" style={{ background: avatarGradient(row.wallet) }}><GogglesMark /></span><span className="leaders-name"><strong>{traderLabel(row.wallet, row.wallet_name)}</strong><small>{resolvedCount(row).toLocaleString()} resolved positions</small></span></Link></div>
            <div className={`leaders-row-profit ${row.net_profit >= 0 ? 'is-positive' : 'is-negative'}`}><span className="leaders-mobile-label">Resolved P&L</span><strong>{fmtSigned(row.net_profit)}</strong></div>
            <div className="leaders-row-rate"><span className="leaders-mobile-label">Win rate</span><strong>{winRate(row)?.toFixed(0)}%</strong><small>{row.won.toLocaleString()} wins</small></div>
            <FollowButton row={row} {...follow} />
          </li>
        ))}</ol>}
        {!loading && !error && ranked.length === 0 && <p className="leaders-notice">{ranking === 'winrate' ? 'No traders meet this minimum yet. Try a lower trade count or browse by P&L.' : 'Rankings will appear as tracked positions resolve.'}</p>}
      </section>
    </div>
  )
}
export default LeaderboardPage
