import { useState, useEffect, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, ChevronDown, Plus, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { dashboardPath } from '../lib/domains'
import { onTabVisible, traderLabel, fmtSigned, fmtFull, fmtAbbrev, avatarGradient } from './helpers'
import GogglesMark from './GogglesMark'
import RecentWins from './RecentWins'
import type { useAlerts } from './useAlerts'
import './leaderboard.css'

// One row of trader_scores: our own roster, scored per market. Top earners,
// and the Experts fallback before the first Polymarket-wide scan lands.
interface ScoreRow {
  wallet: string; wallet_name: string | null
  markets: number; wins: number; pnl: number
  open_positions: number; open_usd: number
}
// One row of expert_traders: a wallet from anywhere on Polymarket scored on
// its closed positions. See supabase/migrations/20261103040000_expert_discovery.sql.
interface ExpertRow {
  wallet: string; wallet_name: string | null
  positions: number; wins: number; win_rate: number; pnl: number; roi: number; all_time_pnl: number | null
  open_positions: number; open_usd: number
}
// One row of insider_leaders: a wallet with a long-shot win we can say why
// about (bought right before the result, or a new/near-empty account), and
// that's still up overall. See the 20261103050000/60000 migrations.
interface InsiderRow {
  wallet: string; wallet_name: string | null; trades: number | null
  open_positions: number; open_usd: number; all_time_pnl: number
  event_title: string; initial_value: number; best_pnl: number
  buy_hours_before: number | null; quick: boolean; few_bets: boolean; new_account: boolean; account_age_days: number | null
}
// What a podium card and a list row render, whichever ranking it came from.
interface Shown {
  wallet: string; wallet_name: string | null; open_positions: number; open_usd: number
  sentence: string; profit: number
  side: string; sideSub: string
  record: string
}
type FollowProps = Pick<ReturnType<typeof useAlerts>, 'watchedWallets' | 'addWallet' | 'removeWallet'>
type Ranking = 'experts' | 'insiders' | 'profit'
const SCORE_COLUMNS = 'wallet,wallet_name,markets,wins,pnl,open_positions,open_usd'
const EXPERT_COLUMNS = 'wallet,wallet_name,positions,wins,win_rate,pnl,roi,all_time_pnl,open_positions,open_usd'
const INSIDER_COLUMNS = 'wallet,wallet_name,trades,open_positions,open_usd,all_time_pnl,event_title,initial_value,best_pnl,buy_hours_before,quick,few_bets,new_account,account_age_days'

const hoursLabel = (h: number) => h < 1 ? 'under an hour' : h < 48 ? `${Math.round(h)} hours` : `${Math.round(h / 24)} days`

// The evidence, in words: why this win looks like someone knew.
function insiderWhy(r: InsiderRow) {
  const why: string[] = []
  if (r.quick && r.buy_hours_before != null) why.push(`${hoursLabel(r.buy_hours_before)} before it happened`)
  if (r.new_account && r.account_age_days != null) why.push(r.account_age_days < 1 ? 'from a brand-new account' : `from a ${r.account_age_days}-day-old account`)
  else if (r.few_bets && r.trades != null) why.push(`from an account with only ${r.trades} bet${r.trades === 1 ? '' : 's'} ever`)
  return why.join(', ')
}

function fromInsider(r: InsiderRow): Shown {
  return {
    wallet: r.wallet, wallet_name: r.wallet_name, open_positions: r.open_positions, open_usd: r.open_usd,
    sentence: `Bet ${fmtAbbrev(r.initial_value)} on "${r.event_title}" ${insiderWhy(r)}`, profit: r.best_pnl,
    side: fmtAbbrev(r.all_time_pnl), sideSub: 'up overall',
    record: `Up ${fmtAbbrev(r.all_time_pnl)} overall`,
  }
}

function fromExpert(r: ExpertRow): Shown {
  const roi = Math.round(r.roi * 100)
  return {
    wallet: r.wallet, wallet_name: r.wallet_name, open_positions: r.open_positions, open_usd: r.open_usd,
    sentence: `Won ${r.wins.toLocaleString()} of ${r.positions.toLocaleString()} bets`, profit: r.all_time_pnl ?? r.pnl,
    side: `${Math.round(r.win_rate * 100)}%`, sideSub: `makes ${roi}¢ per $1`,
    record: `Makes ${roi}¢ for every $1 bet`,
  }
}

function fromScore(r: ScoreRow): Shown {
  const wr = Math.round(r.wins / Math.max(r.markets, 1) * 100)
  return {
    wallet: r.wallet, wallet_name: r.wallet_name, open_positions: r.open_positions, open_usd: r.open_usd,
    sentence: `Won ${r.wins.toLocaleString()} of ${r.markets.toLocaleString()} bets`, profit: r.pnl,
    side: `${wr}%`, sideSub: 'win rate',
    record: `${wr}% win rate`,
  }
}

const RANKING_COPY: Record<Ranking, { label: string; period: string; profit: string; side: string; empty: string }> = {
  experts: {
    label: 'Experts', period: 'Win most of their bets, again and again.',
    profit: 'Total profit', side: 'Win rate', empty: 'No experts found yet. Check back soon.',
  },
  insiders: {
    label: 'Insiders', period: 'Won big on bets almost nobody saw coming, right before the news, and still up overall.',
    profit: 'Won on one bet', side: 'Up overall', empty: 'No insiders found yet. Check back soon.',
  },
  profit: {
    label: 'Top earners', period: 'Most money made.',
    profit: 'Total profit', side: 'Win rate', empty: 'Rankings will appear as tracked positions resolve.',
  },
}

// Small "● 3 open" marker: whether a trader has money in markets right now
// (from Polymarket, refreshed every 10 min by live-signal-service.py).
function OpenBadge({ row, long = false }: { row: { open_positions: number; open_usd: number }; long?: boolean }) {
  const n = row.open_positions
  if (!n) return null
  return <span className="leaders-open" title={`${fmtFull(row.open_usd)} in ${n} open position${n > 1 ? 's' : ''}`}>
    {n} open{long ? ` position${n > 1 ? 's' : ''}` : ''}
  </span>
}

function FollowButton({ row, watchedWallets, addWallet, removeWallet }: FollowProps & { row: { wallet: string; wallet_name: string | null } }) {
  const followed = watchedWallets.find(w => w.wallet.toLowerCase() === row.wallet.toLowerCase())
  return <button type="button" className={`leaders-follow ${followed ? 'is-following' : ''}`} aria-pressed={!!followed}
    aria-label={`${followed ? 'Unfollow' : 'Follow'} ${traderLabel(row.wallet, row.wallet_name)}`}
    onClick={() => followed ? removeWallet(followed.wallet) : addWallet(row.wallet)}>
    {followed ? <X size={15} /> : <Plus size={15} />}{followed ? 'Unfollow' : 'Follow'}
  </button>
}

function Person({ wallet, wallet_name, children }: { wallet: string; wallet_name: string | null; children: ReactNode }) {
  return <Link to={dashboardPath(`/trader/${wallet}`)}>
    <span className="leaders-avatar" style={{ background: avatarGradient(wallet) }}><GogglesMark /></span>
    <span className="leaders-name"><strong>{traderLabel(wallet, wallet_name)}</strong><small>{children}</small></span>
  </Link>
}

function LeaderboardPage(follow: FollowProps) {
  const [rows, setRows] = useState<Shown[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [view, setView] = useState<'rankings' | 'wins'>('rankings')
  const [ranking, setRanking] = useState<Ranking>('experts')
  useEffect(() => {
    let cancelled = false
    let pending = false
    const load = async () => {
      if (pending) return
      pending = true
      try {
        // Filtered and sorted server-side; every source is one row per wallet.
        let next: Shown[]
        if (ranking === 'insiders') {
          const res = await supabase.from('insider_leaders').select(INSIDER_COLUMNS)
            .order('best_pnl', { ascending: false }).order('wallet').limit(100)
          if (res.error) throw res.error
          next = ((res.data ?? []) as InsiderRow[]).map(fromInsider)
        } else if (ranking === 'experts') {
          const res = await supabase.from('expert_traders').select(EXPERT_COLUMNS)
            .eq('is_expert', true).order('pnl', { ascending: false }).order('wallet').limit(100)
          if (res.error) throw res.error
          next = ((res.data ?? []) as ExpertRow[]).map(fromExpert)
          // Before the first Polymarket-wide scan lands (a few minutes after
          // a service restart), show our roster's experts, not an empty board.
          if (next.length === 0) {
            const fb = await supabase.from('trader_scores').select(SCORE_COLUMNS)
              .eq('is_expert', true).order('pnl', { ascending: false }).order('wallet').limit(100)
            if (fb.error) throw fb.error
            next = ((fb.data ?? []) as ScoreRow[]).map(fromScore)
          }
        } else {
          const res = await supabase.from('trader_scores').select(SCORE_COLUMNS)
            .order('pnl', { ascending: false }).order('wallet').limit(100)
          if (res.error) throw res.error
          next = ((res.data ?? []) as ScoreRow[]).map(fromScore)
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
  }, [ranking])

  const copy = RANKING_COPY[ranking]
  const changeRanking = (next: Ranking) => { setLoading(true); setRows([]); setRanking(next) }
  // The top three are the podium cards; the list carries on from #4 so no one
  // appears twice.
  const rest = rows.slice(3)

  return (
    <div className="sig-page leaders-page">
      <header className="app-section-header leaders-header">
        <div><h1 className="app-section-title">Leaderboard</h1><p className="leaders-period">{copy.period}</p></div>
        {view === 'rankings' && (
          <div className="leaders-header-controls">
            <label className="leaders-select">
              <select aria-label="Leaderboard" value={ranking} onChange={e => changeRanking(e.target.value as Ranking)}>
                {(Object.keys(RANKING_COPY) as Ranking[]).map(r => <option key={r} value={r}>{RANKING_COPY[r].label}</option>)}
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
          {loading ? [0, 1, 2].map(i => <div className="leaders-podium-skeleton sig-skel" key={i} aria-hidden="true" />) : rows.slice(0, 3).map((row, index) => (
            <article className={`leaders-card leaders-place-${index + 1}`} key={row.wallet}>
              <div className="leaders-card-top"><span className="leaders-place">#{index + 1}</span><Link to={dashboardPath(`/trader/${row.wallet}`)} aria-label={`View ${traderLabel(row.wallet, row.wallet_name)}`}><ArrowUpRight size={18} /></Link></div>
              <Link className="leaders-card-person" to={dashboardPath(`/trader/${row.wallet}`)}><span className="leaders-avatar" style={{ background: avatarGradient(row.wallet) }}><GogglesMark /></span><h2>{traderLabel(row.wallet, row.wallet_name)}</h2></Link>
              <OpenBadge row={row} long />
              <strong className={`leaders-card-profit ${row.profit >= 0 ? 'is-positive' : 'is-negative'}`}>{fmtSigned(row.profit)}</strong><span className="leaders-metric-label">{copy.profit}</span>
              <div className="leaders-card-record"><strong>{row.record}</strong><span>{row.sentence}</span></div>
              <FollowButton row={row} {...follow} />
            </article>
          ))}
        </section>
        {(loading || rest.length > 0) && (
          <section className="leaders-list" aria-label="More traders" aria-busy={loading}>
            <div className="leaders-column-head" aria-hidden="true"><span>Trader</span><span>{copy.profit}</span><span>{copy.side}</span><span /></div>
            {loading ? [0, 1, 2, 3, 4].map(i => <div key={i} className="leaders-row-skeleton sig-skel" aria-hidden="true" />) : <ol className="leaders-rows" start={4}>{rest.map((row, index) => (
              <li className="leaders-row" key={row.wallet}>
                <div className="leaders-person"><span className="leaders-rank">{index + 4}</span><Person wallet={row.wallet} wallet_name={row.wallet_name}>{row.sentence} <OpenBadge row={row} /></Person></div>
                <div className={`leaders-row-profit ${row.profit >= 0 ? 'is-positive' : 'is-negative'}`}><span className="leaders-mobile-label">{copy.profit}</span><strong>{fmtSigned(row.profit)}</strong></div>
                <div className="leaders-row-rate"><span className="leaders-mobile-label">{copy.side}</span><strong>{row.side}</strong><small>{row.sideSub}</small></div>
                <FollowButton row={row} {...follow} />
              </li>
            ))}</ol>}
          </section>
        )}
        {!loading && !error && rows.length === 0 && <p className="leaders-notice">{copy.empty}</p>}
      </>)}

      {view === 'wins' && <RecentWins />}
    </div>
  )
}
export default LeaderboardPage
