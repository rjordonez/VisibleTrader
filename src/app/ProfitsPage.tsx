import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { dashboardPath } from '../lib/domains'
import { onTabVisible, fmtSigned, fmtFull, traderLabel, timeAgo, avatarGradient, avatarInitial } from './helpers'
import { CumulativeChart } from './PriceChart'
import './profits.css'

interface ProfitsSummary { resolved_n: number; won: number; lost: number; deployed: number; net_profit: number }
interface ProfitsDaily { d: string; day_profit: number }
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
  const [error, setError] = useState(false)
  const [resultFilter, setResultFilter] = useState<'all' | 'won' | 'lost'>('all')

  useEffect(() => {
    let cancelled = false
    let pending = false
    const load = async () => {
      if (pending) return
      pending = true
      try {
        const [summaryRes, dailyRes, positionsRes] = await Promise.all([
          supabase.from('profits_summary').select('*').single(),
          supabase.from('profits_daily').select('*').order('d', { ascending: true }),
          supabase.from('wallet_positions').select('*').eq('market_closed', true).order('resolved_ts', { ascending: false }).limit(200),
        ])
        if (summaryRes.error) throw summaryRes.error
        if (dailyRes.error) throw dailyRes.error
        if (positionsRes.error) throw positionsRes.error
        if (!cancelled) {
          setSummary(summaryRes.data as ProfitsSummary | null)
          setDaily((dailyRes.data ?? []) as ProfitsDaily[])
          setPositions((positionsRes.data ?? []) as ProfitsPosition[])
          setLoading(false)
          setError(false)
        }
      } catch {
        if (!cancelled) { setError(true); setLoading(false) }
      } finally { pending = false }
    }
    void load()
    const interval = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 15000)
    const unsubscribe = onTabVisible(() => { void load() })
    return () => { cancelled = true; clearInterval(interval); unsubscribe() }
  }, [])

  const resolved = summary ? summary.won + summary.lost : 0
  const winRate = resolved > 0 ? summary!.won / resolved * 100 : null
  const roi = summary && summary.deployed > 0 ? summary.net_profit / summary.deployed * 100 : null
  const cumulative = daily.reduce<{ d: string; cum: number }[]>((acc, day) => {
    acc.push({ d: day.d, cum: (acc.at(-1)?.cum ?? 0) + day.day_profit })
    return acc
  }, [])
  const filtered = positions.filter(p => resultFilter === 'all' || (resultFilter === 'won' ? p.resolved_win : !p.resolved_win))

  return (
    <div className="sig-page profits-page">
      <header className="app-section-header">
        <div><h1 className="app-section-title">Profits</h1><p className="app-section-sub">Resolved results from tracked traders.</p></div>
        <span className="profits-period">All tracked history</span>
      </header>
      {error && <p className="profits-notice" role="status">Unable to refresh results. {summary ? 'Showing the last available data. ' : ''}Retrying automatically.</p>}
      {loading ? <div aria-label="Loading profits" aria-busy="true"><div className="profits-overview-skeleton sig-skel" />{[0, 1, 2, 3].map(i => <div className="profits-row-skeleton sig-skel" key={i} />)}</div> : summary && summary.resolved_n > 0 ? <>
        <section className="profits-overview" aria-labelledby="profits-net-title">
          <div className="profits-net-heading">
            <div><h2 id="profits-net-title">Total resolved P&L</h2><strong className={`profits-net-value ${summary.net_profit >= 0 ? 'is-positive' : 'is-negative'}`}>{fmtSigned(summary.net_profit)}</strong></div>
            <div className="profits-net-context"><strong>{summary.resolved_n.toLocaleString()}</strong><span>resolved positions</span></div>
          </div>
          <div className="profits-chart-area">
            <p className="profits-chart-label">Cumulative resolved P&L</p>
            {cumulative.length > 1 ? <CumulativeChart data={cumulative} height={250} /> : <p className="profits-notice">The chart will appear once results span more than one day.</p>}
          </div>
          <dl className="profits-supporting-stats">
            <div><dt>Win rate</dt><dd>{winRate === null ? '—' : `${winRate.toFixed(1)}%`}</dd></div>
            <div><dt>Return on deployed capital</dt><dd className={roi === null ? '' : roi >= 0 ? 'is-positive' : 'is-negative'}>{roi === null ? '—' : `${roi >= 0 ? '+' : ''}${roi.toFixed(1)}%`}</dd></div>
            <div><dt>Total deployed</dt><dd>{fmtFull(summary.deployed)}</dd></div>
          </dl>
        </section>

        {resolved > 0 && <section className="profits-outcomes" aria-label="Resolved wins and losses">
          <div className="profits-outcome-labels"><span><strong>{summary.won.toLocaleString()}</strong> wins</span><span><strong>{summary.lost.toLocaleString()}</strong> losses</span></div>
          <div className="profits-outcome-bar" aria-hidden="true"><span className="profits-wins-bar" style={{ flex: summary.won }} /><span className="profits-losses-bar" style={{ flex: summary.lost }} /></div>
        </section>}

        <section className="profits-results" aria-labelledby="profits-results-title">
          <header className="profits-results-heading">
            <div><h2 id="profits-results-title">Behind the numbers</h2><p>Latest {positions.length} resolved positions · Most recent first</p></div>
            <label className="profits-filter"><select aria-label="Filter recent results" value={resultFilter} onChange={e => setResultFilter(e.target.value as typeof resultFilter)}><option value="all">All results</option><option value="won">Wins</option><option value="lost">Losses</option></select><ChevronDown size={15} aria-hidden="true" /></label>
          </header>
          <div className="profits-list-head" aria-hidden="true"><span>Market & trader</span><span>Stake / entry</span><span>Result</span></div>
          <ol className="profits-result-list">{filtered.map((p, i) => <li className="profits-result-row" key={`${p.wallet}:${p.resolved_ts}:${p.title}:${p.outcome}:${i}`}>
            <div className="profits-position">
              <h3>{p.title}</h3>
              <div className="profits-trader-line">
                {p.wallet ? <Link to={dashboardPath(`/trader/${p.wallet}`)}><span className="profits-avatar" style={{ background: avatarGradient(p.wallet) }}>{avatarInitial(p.wallet, p.wallet_name)}</span>{traderLabel(p.wallet, p.wallet_name)}</Link> : <span>Unknown trader</span>}
                <span>· {p.outcome}</span>
              </div>
            </div>
            <div className="profits-entry"><strong>{fmtFull(p.usd)}</strong><span>{Math.round(p.price * 100)}¢ entry</span></div>
            <div className="profits-result-value"><strong className={p.profit >= 0 ? 'is-positive' : 'is-negative'}>{fmtSigned(p.profit)}</strong><span><span className={p.resolved_win ? 'is-positive' : 'is-negative'}>{p.resolved_win ? 'Won' : 'Lost'}</span> · <time dateTime={p.resolved_ts}>{timeAgo(p.resolved_ts)}</time></span></div>
          </li>)}</ol>
          {filtered.length === 0 && <p className="profits-notice">{positions.length === 0 ? 'No recent resolved positions are available.' : `No ${resultFilter === 'won' ? 'wins' : 'losses'} in these ${positions.length} recent positions.`}</p>}
        </section>
      </> : !error && <p className="profits-notice">No resolved positions yet. Results will appear as tracked markets settle.</p>}
    </div>
  )
}
export default ProfitsPage
