import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronDown, Plus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { dashboardPath } from '../lib/domains'
import { onTabVisible, traderLabel, fmtSigned, fmtFull, avatarGradient } from './helpers'
import GogglesMark from './GogglesMark'
import RecentWins from './RecentWins'
import type { useAlerts } from './useAlerts'
import './leaderboard.css'

// One row of trader_scores: each wallet scored per market (not per fill)
// against the odds it paid. See supabase/migrations/20261103000000_trader_scores.sql
// for how experts and insiders are defined.
interface LeaderboardRow {
  wallet: string; wallet_name: string | null
  markets: number; wins: number; expected_wins: number; pnl: number
  longshots: number; longshot_wins: number; longshot_expected: number; longshot_pnl: number
  open_positions: number; open_usd: number
}
type FollowProps = Pick<ReturnType<typeof useAlerts>, 'watchedWallets' | 'addWallet' | 'removeWallet'>
type Ranking = 'experts' | 'insiders' | 'profit'
const COLUMNS = 'wallet,wallet_name,markets,wins,expected_wins,pnl,longshots,longshot_wins,longshot_expected,longshot_pnl,open_positions,open_usd'
const pct = (n: number, d: number) => d > 0 ? Math.round(n / d * 100) : 0
const winRate = (r: LeaderboardRow) => pct(r.wins, r.markets)
// Average entry price = the win rate the market expected from them.
const oddsPaid = (r: LeaderboardRow) => pct(r.expected_wins, r.markets)
const longshotOdds = (r: LeaderboardRow) => pct(r.longshot_expected, r.longshots)
// Small "● 3 open" marker: whether a trader has money in markets right now
// (from Polymarket, refreshed every 10 min by live-signal-service.py).
function OpenBadge({ row, long = false }: { row: LeaderboardRow; long?: boolean }) {
  const n = row.open_positions
  if (!n) return null
  return <span className="leaders-open" title={`${fmtFull(row.open_usd)} in ${n} open position${n > 1 ? 's' : ''}`}>
    {n} open{long ? ` position${n > 1 ? 's' : ''}` : ''}
  </span>
}

const shownProfit = (r: LeaderboardRow, ranking: Ranking) => ranking === 'insiders' ? r.longshot_pnl : r.pnl

const RANKING_COPY: Record<Ranking, { period: string; profit: string; rate: string; noun: string; empty: string }> = {
  experts: {
    period: 'Beat the market\'s odds across 25+ markets', profit: 'Resolved P&L', rate: 'Win rate', noun: 'experts',
    empty: 'No traders have beaten the odds consistently enough yet.',
  },
  insiders: {
    period: 'Cashed long-shot bets outside sports', profit: 'Long-shot profit', rate: 'Long shots hit', noun: 'insiders',
    empty: 'No long-shot hits that look like inside information yet.',
  },
  profit: {
    period: 'All tracked history', profit: 'Resolved P&L', rate: 'Win rate', noun: 'traders',
    empty: 'Rankings will appear as tracked positions resolve.',
  },
}

function RecordLine({ row, ranking }: { row: LeaderboardRow; ranking: Ranking }) {
  if (ranking === 'insiders') return <><strong>{row.longshot_wins} of {row.longshots} <span>long shots</span></strong><span>avg {longshotOdds(row)}% odds</span></>
  if (ranking === 'experts') return <><strong>{winRate(row)}% <span>win rate</span></strong><span>vs {oddsPaid(row)}% odds</span></>
  return <><strong>{winRate(row)}% <span>win rate</span></strong><span>{row.markets.toLocaleString()} markets</span></>
}

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
  const [view, setView] = useState<'rankings' | 'wins'>('rankings')
  const [ranking, setRanking] = useState<Ranking>('experts')
  const [total, setTotal] = useState(0)
  useEffect(() => {
    let cancelled = false
    let pending = false
    const load = async () => {
      if (pending) return
      pending = true
      try {
        // Filtered and sorted server-side; trader_scores is one row per wallet.
        let query = supabase.from('trader_scores').select(COLUMNS, { count: 'exact' })
        if (ranking === 'experts') query = query.eq('is_expert', true).order('edge_pts', { ascending: false })
        else if (ranking === 'insiders') query = query.eq('is_insider', true).order('longshot_pnl', { ascending: false })
        else query = query.order('pnl', { ascending: false })
        const { data, count, error: queryError } = await query.order('wallet').limit(100)
        if (queryError) throw queryError
        const next = (data ?? []) as LeaderboardRow[]
        if (!cancelled) setTotal(count ?? next.length)
        if (!cancelled) { setRows(next); setError(false); setLoading(false) }
      } catch {
        if (!cancelled) { setError(true); setLoading(false) }
      } finally { pending = false }
    }
    void load()
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60000)
    const unsubscribe = onTabVisible(() => { void load() })
    return () => { cancelled = true; clearInterval(interval); unsubscribe() }
  }, [ranking])

  const ranked = rows
  const copy = RANKING_COPY[ranking]
  const changeRanking = (next: Ranking) => { setLoading(true); setRows([]); setRanking(next) }

  return (
    <div className="sig-page leaders-page">
      <header className="app-section-header leaders-header">
        <div><h1 className="app-section-title">Leaderboard</h1><p className="leaders-period">{copy.period}</p></div>
        {view === 'rankings' && (
          <div className="leaders-header-controls">
            <label className="leaders-select">
              <select aria-label="Rank traders by" value={ranking} onChange={e => changeRanking(e.target.value as Ranking)}>
                <option value="experts">Experts</option>
                <option value="insiders">Insiders</option>
                <option value="profit">Highest P&L</option>
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </label>
          </div>
        )}
      </header>

      <div className="sig-seg" role="tablist" aria-label="Leaderboard view">
        <button type="button" role="tab" aria-selected={view === 'rankings'}
          className={view === 'rankings' ? 'sig-seg-btn active' : 'sig-seg-btn'}
          onClick={() => setView('rankings')}>Rankings</button>
        <button type="button" role="tab" aria-selected={view === 'wins'}
          className={view === 'wins' ? 'sig-seg-btn active' : 'sig-seg-btn'}
          onClick={() => setView('wins')}>Recent wins</button>
      </div>

      {view === 'rankings' && (<>
        {error && <p className="leaders-notice" role="status">Unable to refresh rankings. {rows.length > 0 ? 'Showing the last available data. ' : ''}Retrying automatically.</p>}
        <section className="leaders-podium" aria-label="Top three traders" aria-busy={loading}>
          {loading ? [0, 1, 2].map(i => <div className="leaders-podium-skeleton sig-skel" key={i} aria-hidden="true" />) : ranked.slice(0, 3).map((row, index) => (
            <article className={`leaders-card leaders-place-${index + 1}`} key={row.wallet}>
              <div className="leaders-card-top"><span className="leaders-place">#{index + 1}</span><Link to={dashboardPath(`/trader/${row.wallet}`)} aria-label={`View ${traderLabel(row.wallet, row.wallet_name)}`}><ArrowUpRight size={18} /></Link></div>
              <Link className="leaders-card-person" to={dashboardPath(`/trader/${row.wallet}`)}><span className="leaders-avatar" style={{ background: avatarGradient(row.wallet) }}><GogglesMark /></span><h2>{traderLabel(row.wallet, row.wallet_name)}</h2></Link>
              <OpenBadge row={row} long />
              <strong className={`leaders-card-profit ${shownProfit(row, ranking) >= 0 ? 'is-positive' : 'is-negative'}`}>{fmtSigned(shownProfit(row, ranking))}</strong><span className="leaders-metric-label">{copy.profit}</span>
              <div className="leaders-card-record"><RecordLine row={row} ranking={ranking} /></div>
              <FollowButton row={row} {...follow} />
            </article>
          ))}
        </section>
        <section className="leaders-list" aria-labelledby="leaders-list-title" aria-busy={loading}>
          <div className="leaders-list-heading"><h2 id="leaders-list-title">The rankings</h2>{!loading && <span>{ranked.length} of {total.toLocaleString()} {copy.noun}</span>}</div>
          <div className="leaders-column-head" aria-hidden="true"><span>Trader</span><span>{copy.profit}</span><span>{copy.rate}</span><span /></div>
          {loading ? [0, 1, 2, 3, 4].map(i => <div key={i} className="leaders-row-skeleton sig-skel" aria-hidden="true" />) : <ol className="leaders-rows">{ranked.map((row, index) => (
            <li className="leaders-row" key={row.wallet}>
              <div className="leaders-person"><span className="leaders-rank">{index + 1}</span><Link to={dashboardPath(`/trader/${row.wallet}`)}><span className="leaders-avatar" style={{ background: avatarGradient(row.wallet) }}><GogglesMark /></span><span className="leaders-name"><strong>{traderLabel(row.wallet, row.wallet_name)}</strong><small>{row.markets.toLocaleString()} markets <OpenBadge row={row} /></small></span></Link></div>
              <div className={`leaders-row-profit ${shownProfit(row, ranking) >= 0 ? 'is-positive' : 'is-negative'}`}><span className="leaders-mobile-label">{copy.profit}</span><strong>{fmtSigned(shownProfit(row, ranking))}</strong></div>
              <div className="leaders-row-rate"><span className="leaders-mobile-label">{copy.rate}</span>{ranking === 'insiders'
                ? <><strong>{row.longshot_wins}/{row.longshots}</strong><small>avg {longshotOdds(row)}% odds</small></>
                : <><strong>{winRate(row)}%</strong><small>{ranking === 'experts' ? `vs ${oddsPaid(row)}% odds` : `${row.wins.toLocaleString()} wins`}</small></>}</div>
              <FollowButton row={row} {...follow} />
            </li>
          ))}</ol>}
          {!loading && !error && ranked.length === 0 && <p className="leaders-notice">{copy.empty}</p>}
        </section>
      </>)}

      {view === 'wins' && <RecentWins />}
    </div>
  )
}
export default LeaderboardPage
