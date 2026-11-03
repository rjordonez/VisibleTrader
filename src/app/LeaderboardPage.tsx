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

// One row of trader_scores: each wallet scored per market (not per fill)
// against the odds it paid. See supabase/migrations/20261103000000_trader_scores.sql
// for how experts are defined.
interface ScoreRow {
  wallet: string; wallet_name: string | null
  markets: number; wins: number; expected_wins: number; pnl: number
  open_positions: number; open_usd: number
}
// One row of expert_traders: a wallet from anywhere on Polymarket scored on
// its closed positions. See supabase/migrations/20261103040000_expert_discovery.sql.
interface ExpertRow {
  wallet: string; wallet_name: string | null
  positions: number; win_rate: number; pnl: number; roi: number
  open_positions: number; open_usd: number
}
// One row of insider_leaders: a wallet from anywhere on Polymarket with
// insider-pattern long-shot wins, and its biggest one. See
// supabase/migrations/20261103030000_insider_discovery.sql.
interface InsiderRow {
  wallet: string; wallet_name: string | null; trades: number | null
  open_positions: number; open_usd: number
  hits: number; total_pnl: number
  event_title: string; initial_value: number; final_value: number
  multiplier: number; entry_odds: number; buy_hours_before: number | null
}
interface AlertRow {
  wallet: string; wallet_name: string | null; token_id: string
  question: string; event_slug: string; outcome: string
  entry_cost: number; avg_price: number; current_price: number; end_date: string
}
// What a podium card and a list row render, whichever ranking it came from.
interface Shown {
  wallet: string; wallet_name: string | null; open_positions: number; open_usd: number
  sub: string; profit: number
  rate: ReactNode; rateSub: string
  record: ReactNode; recordSub: string
}
type FollowProps = Pick<ReturnType<typeof useAlerts>, 'watchedWallets' | 'addWallet' | 'removeWallet'>
type Ranking = 'experts' | 'insiders' | 'profit'
const SCORE_COLUMNS = 'wallet,wallet_name,markets,wins,expected_wins,pnl,open_positions,open_usd'
const EXPERT_COLUMNS = 'wallet,wallet_name,positions,win_rate,pnl,roi,open_positions,open_usd'
const INSIDER_COLUMNS = 'wallet,wallet_name,trades,open_positions,open_usd,hits,total_pnl,event_title,initial_value,final_value,multiplier,entry_odds,buy_hours_before'
const pct = (n: number, d: number) => d > 0 ? Math.round(n / d * 100) : 0
// Under 1% reads as "0%" otherwise.
const oddsLabel = (p: number) => p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`
const timingLabel = (h: number | null) => h == null ? null : h < 1 ? 'under an hour before' : h < 48 ? `${Math.round(h)}h before` : `${Math.round(h / 24)} days before`

function fromScore(r: ScoreRow): Shown {
  const wr = pct(r.wins, r.markets)
  return {
    wallet: r.wallet, wallet_name: r.wallet_name, open_positions: r.open_positions, open_usd: r.open_usd,
    sub: `${r.markets.toLocaleString()} resolved`, profit: r.pnl,
    rate: `${wr}%`, rateSub: `${r.wins.toLocaleString()} wins`,
    record: <>{wr}% <span>win rate</span></>, recordSub: `${r.markets.toLocaleString()} resolved`,
  }
}

function fromExpert(r: ExpertRow): Shown {
  const wr = Math.round(r.win_rate * 100)
  const roi = `${r.roi >= 0 ? '+' : ''}${Math.round(r.roi * 100)}% return`
  return {
    wallet: r.wallet, wallet_name: r.wallet_name, open_positions: r.open_positions, open_usd: r.open_usd,
    sub: `${r.positions.toLocaleString()} markets`, profit: r.pnl,
    rate: `${wr}%`, rateSub: roi,
    record: <>{wr}% <span>win rate</span></>, recordSub: `${roi} across ${r.positions.toLocaleString()} markets`,
  }
}

function fromInsider(r: InsiderRow): Shown {
  const timing = timingLabel(r.buy_hours_before)
  return {
    wallet: r.wallet, wallet_name: r.wallet_name, open_positions: r.open_positions, open_usd: r.open_usd,
    sub: r.event_title, profit: r.total_pnl,
    rate: `${Math.round(r.multiplier)}x`, rateSub: `${fmtAbbrev(r.initial_value)} → ${fmtAbbrev(r.final_value)}`,
    record: <>{Math.round(r.multiplier)}x <span>on a {oddsLabel(r.entry_odds)} shot</span></>,
    recordSub: timing ? `Bought ${timing} · ${r.event_title}` : r.event_title,
  }
}

const RANKING_COPY: Record<Ranking, { period: string; profit: string; rate: string; noun: string; empty: string }> = {
  experts: {
    period: 'Consistently profitable across 50+ markets, from anywhere on Polymarket', profit: 'Realized P&L', rate: 'Win rate', noun: 'experts',
    empty: 'No experts found yet. The scan runs every 6 hours.',
  },
  insiders: {
    period: 'Long shots outside sports, bought right before the result or from new wallets. A pattern, not proof.',
    profit: 'Long-shot profit', rate: 'Best hit', noun: 'insiders',
    empty: 'No insider-pattern wins found yet. The scan runs every 30 minutes.',
  },
  profit: {
    period: 'All tracked history', profit: 'Resolved P&L', rate: 'Win rate', noun: 'traders',
    empty: 'Rankings will appear as tracked positions resolve.',
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

const endsIn = (iso: string) => {
  const days = (new Date(iso).getTime() - Date.now()) / 86400000
  return days < 1 ? 'ends today' : `ends in ${Math.round(days)}d`
}

// Open long-shot bets right now by wallets with little history, in markets
// resolving within 3 weeks (insider_alerts, rescanned every 10 min).
function LiveInsiderBets(follow: FollowProps) {
  const [alerts, setAlerts] = useState<AlertRow[] | null>(null)
  const [trades, setTrades] = useState<Map<string, number | null>>(new Map())
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const { data } = await supabase.from('insider_alerts')
        .select('wallet,wallet_name,token_id,question,event_slug,outcome,entry_cost,avg_price,current_price,end_date')
        .order('score', { ascending: false }).order('entry_cost', { ascending: false }).limit(20)
      const rows = (data ?? []) as AlertRow[]
      const { data: w } = rows.length
        ? await supabase.from('insider_wallets').select('wallet,trades').in('wallet', [...new Set(rows.map(r => r.wallet))])
        : { data: [] }
      if (cancelled) return
      setAlerts(rows)
      setTrades(new Map(((w ?? []) as { wallet: string; trades: number | null }[]).map(x => [x.wallet, x.trades])))
    }
    void load()
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])
  if (!alerts || alerts.length === 0) return null
  return (
    <section className="leaders-list" aria-labelledby="leaders-live-title">
      <div className="leaders-list-heading"><h2 id="leaders-live-title">Live insider-pattern bets</h2><span>Open long shots from wallets with little history, in markets ending within 3 weeks</span></div>
      <div className="leaders-column-head" aria-hidden="true"><span>Trader</span><span>Bet</span><span>Bought at</span><span /></div>
      <ol className="leaders-rows">{alerts.map((a, index) => {
        const t = trades.get(a.wallet)
        return (
          <li className="leaders-row" key={`${a.wallet}:${a.token_id}`}>
            <div className="leaders-person"><span className="leaders-rank">{index + 1}</span>
              <Person wallet={a.wallet} wallet_name={a.wallet_name}>
                {a.outcome} · {a.question}{t != null ? ` · ${t.toLocaleString()} lifetime market${t === 1 ? '' : 's'}` : ''}
              </Person>
            </div>
            <div className="leaders-row-profit is-positive"><span className="leaders-mobile-label">Bet</span><strong>{fmtFull(a.entry_cost)}</strong></div>
            <div className="leaders-row-rate"><span className="leaders-mobile-label">Bought at</span><strong>{oddsLabel(a.avg_price)}</strong><small>now {oddsLabel(a.current_price)} · {endsIn(a.end_date)}</small></div>
            <FollowButton row={a} {...follow} />
          </li>
        )
      })}</ol>
    </section>
  )
}

function LeaderboardPage(follow: FollowProps) {
  const [rows, setRows] = useState<Shown[]>([])
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
        // Filtered and sorted server-side; both sources are one row per wallet.
        let next: Shown[]
        let count: number | null
        if (ranking === 'insiders') {
          const res = await supabase.from('insider_leaders').select(INSIDER_COLUMNS, { count: 'exact' })
            .order('total_pnl', { ascending: false }).order('wallet').limit(100)
          if (res.error) throw res.error
          next = ((res.data ?? []) as InsiderRow[]).map(fromInsider)
          count = res.count
        } else if (ranking === 'experts') {
          const res = await supabase.from('expert_traders').select(EXPERT_COLUMNS, { count: 'exact' })
            .eq('is_expert', true).order('pnl', { ascending: false }).order('wallet').limit(100)
          if (res.error) throw res.error
          next = ((res.data ?? []) as ExpertRow[]).map(fromExpert)
          count = res.count
        } else {
          const res = await supabase.from('trader_scores').select(SCORE_COLUMNS, { count: 'exact' })
            .order('pnl', { ascending: false }).order('wallet').limit(100)
          if (res.error) throw res.error
          next = ((res.data ?? []) as ScoreRow[]).map(fromScore)
          count = res.count
        }
        if (!cancelled) { setRows(next); setTotal(count ?? next.length); setError(false); setLoading(false) }
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
              <strong className={`leaders-card-profit ${row.profit >= 0 ? 'is-positive' : 'is-negative'}`}>{fmtSigned(row.profit)}</strong><span className="leaders-metric-label">{copy.profit}</span>
              <div className="leaders-card-record"><strong>{row.record}</strong><span>{row.recordSub}</span></div>
              <FollowButton row={row} {...follow} />
            </article>
          ))}
        </section>
        {ranking === 'insiders' && <LiveInsiderBets {...follow} />}
        <section className="leaders-list" aria-labelledby="leaders-list-title" aria-busy={loading}>
          <div className="leaders-list-heading"><h2 id="leaders-list-title">The rankings</h2>{!loading && <span>{ranked.length} of {total.toLocaleString()} {copy.noun}</span>}</div>
          <div className="leaders-column-head" aria-hidden="true"><span>Trader</span><span>{copy.profit}</span><span>{copy.rate}</span><span /></div>
          {loading ? [0, 1, 2, 3, 4].map(i => <div key={i} className="leaders-row-skeleton sig-skel" aria-hidden="true" />) : <ol className="leaders-rows">{ranked.map((row, index) => (
            <li className="leaders-row" key={row.wallet}>
              <div className="leaders-person"><span className="leaders-rank">{index + 1}</span><Person wallet={row.wallet} wallet_name={row.wallet_name}>{row.sub} <OpenBadge row={row} /></Person></div>
              <div className={`leaders-row-profit ${row.profit >= 0 ? 'is-positive' : 'is-negative'}`}><span className="leaders-mobile-label">{copy.profit}</span><strong>{fmtSigned(row.profit)}</strong></div>
              <div className="leaders-row-rate"><span className="leaders-mobile-label">{copy.rate}</span><strong>{row.rate}</strong><small>{row.rateSub}</small></div>
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
