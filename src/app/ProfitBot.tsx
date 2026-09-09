import { useEffect, useState } from 'react'
import { Bot, ChevronDown, HelpCircle, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmtSigned, timeAgo, categoryLabel } from './helpers'
import { CumulativeChart } from './PriceChart'
import { ExpertPickCard } from './ExpertPickCard'
import { SignalModal } from './SignalModal'
import type { Opportunity } from './types'
import './signals.css'

// The whole Profits page. Reads the profit_bot_* RPCs (see
// supabase/migrations/20260909060000_profit_bot.sql and follow-ups): a
// rules-based strategy over the tracked-trader data — act on a side only
// when 5+ proven wallets (net-positive, >=52% win rate, >=20 resolved) are
// on it at 40-80c entry with >=$100 size.
interface BotResolved {
  condition_id: string
  outcome: string
  title: string
  category: string | null
  experts: number
  avg_entry: number
  won: boolean
  pnl: number
  resolved_ts: string
}
interface BotPerf {
  picks: number
  won: number
  lost: number
  win_rate: number
  avg_return_pct: number
  avg_entry: number
  flat100_pnl: number
  since: string
}
interface BotDay {
  d: string
  day_pnl: number
}

export default function ProfitBot() {
  const [picks, setPicks] = useState<Opportunity[]>([])
  const [resolved, setResolved] = useState<BotResolved[]>([])
  const [perf, setPerf] = useState<BotPerf | null>(null)
  const [daily, setDaily] = useState<BotDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [view, setView] = useState<'ongoing' | 'resolved'>('ongoing')
  const [sort, setSort] = useState<'recent' | 'profitable'>('recent')
  const [helpOpen, setHelpOpen] = useState(false)
  const [modalOpp, setModalOpp] = useState<Opportunity | null>(null)

  useEffect(() => {
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const load = async (attempt = 0) => {
      const [pi, re, pe, da] = await Promise.all([
        supabase.rpc('profit_bot_picks'),
        supabase.rpc('profit_bot_resolved'),
        supabase.rpc('profit_bot_performance'),
        supabase.rpc('profit_bot_daily'),
      ])
      if (cancelled) return
      if (pi.error || re.error || pe.error || da.error) {
        // Transient DB errors happen; back off and retry a few times before
        // giving up so a blip doesn't need a page reload.
        if (attempt < 4) {
          retry = setTimeout(() => void load(attempt + 1), 1500 * (attempt + 1))
          return
        }
        setError(true)
      } else {
        setPicks((pi.data ?? []) as Opportunity[])
        setResolved((re.data ?? []) as BotResolved[])
        setPerf(((pe.data ?? [])[0] ?? null) as BotPerf | null)
        setDaily((da.data ?? []) as BotDay[])
        setError(false)
      }
      setLoading(false)
    }
    void load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60000)
    return () => { cancelled = true; clearInterval(t); clearTimeout(retry) }
  }, [])

  const cumulative = daily.reduce<{ d: string; cum: number }[]>((acc, day) => {
    acc.push({ d: day.d, cum: (acc.at(-1)?.cum ?? 0) + Number(day.day_pnl) })
    return acc
  }, [])
  // `since` is a bare date; parse at midday so it doesn't shift a day back
  // in western timezones.
  const sinceLabel = perf
    ? new Date(`${perf.since}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : ''
  const flat100Pnl = perf ? fmtSigned(perf.flat100_pnl) : null

  if (loading) {
    return <div className="profits-overview-skeleton sig-skel" aria-busy="true" aria-label="Loading Profit Bot" />
  }
  if (error || !perf) {
    return <p className="profits-notice" role="status">Couldn&rsquo;t load Profit Bot right now. Retrying.</p>
  }

  return (
    <>
      <section className="profits-overview pbot-overview" aria-labelledby="pbot-title">
        <div className="pbot-hero-head">
          <span className="pbot-badge"><Bot size={13} aria-hidden="true" /> Profit Bot</span>
          <button
            type="button"
            className="pbot-help-btn"
            onClick={() => setHelpOpen(o => !o)}
            aria-expanded={helpOpen}
            aria-controls="pbot-help"
            aria-label={helpOpen ? 'Hide how the bot works' : 'How the bot works'}
          >
            {helpOpen ? <X size={15} aria-hidden="true" /> : <HelpCircle size={16} aria-hidden="true" />}
          </button>
        </div>

        {helpOpen && (
          <div className="pbot-help" id="pbot-help">
            <p>
              Profit Bot only acts where the edge has held:
            </p>
            <ul>
              <li><strong>Proven traders.</strong> The ~110 wallets (of ~470 tracked) that are net-positive with a 52%+ win rate over 20+ resolved bets.</li>
              <li><strong>Consensus.</strong> 5 or more of them on the same side of one market. Three or four isn&rsquo;t enough. At five the win rate jumps to ~74%.</li>
              <li><strong>Priced 40 to 80&cent;.</strong> Skips penny longshots and near-certain 90&cent;+ scalps.</li>
              <li><strong>Real size.</strong> The trader put at least $100 behind the position.</li>
            </ul>
            <p className="pbot-help-foot">
              Backtested on every resolved pick since {sinceLabel}: {perf.win_rate}% win rate,
              {' '}{flat100Pnl} on a flat $100 per pick. Past results don&rsquo;t predict future ones. Not financial advice.
            </p>
          </div>
        )}

        <div className="profits-net-heading">
          <div>
            <h2 id="pbot-title">If you&rsquo;d staked $100 a pick</h2>
            <strong className={`profits-net-value ${perf.flat100_pnl >= 0 ? 'is-positive' : 'is-negative'}`}>{flat100Pnl}</strong>
          </div>
          <div className="profits-net-context">
            <strong>{perf.picks.toLocaleString()}</strong>
            <span>resolved picks since {sinceLabel}</span>
          </div>
        </div>

        <div className="profits-chart-area">
          <p className="profits-chart-label">Cumulative P&amp;L, flat $100 per pick</p>
          {cumulative.length > 1
            ? <CumulativeChart data={cumulative} height={250} />
            : <p className="profits-notice">The curve appears once picks span more than one day.</p>}
        </div>

        <dl className="profits-supporting-stats">
          <div><dt>Win rate</dt><dd>{perf.win_rate}%</dd></div>
          <div>
            <dt>Avg return per pick</dt>
            <dd className={perf.avg_return_pct >= 0 ? 'is-positive' : 'is-negative'}>
              {perf.avg_return_pct >= 0 ? '+' : ''}{perf.avg_return_pct}%
            </dd>
          </div>
          <div><dt>Avg entry price</dt><dd>{Math.round(perf.avg_entry * 100)}&cent;</dd></div>
        </dl>
      </section>

      <section className="profits-outcomes" aria-label="Resolved picks won and lost">
        <div className="profits-outcome-labels">
          <span><strong>{perf.won.toLocaleString()}</strong> won</span>
          <span><strong>{perf.lost.toLocaleString()}</strong> lost</span>
        </div>
        <div className="profits-outcome-bar" aria-hidden="true">
          <span className="profits-wins-bar" style={{ flex: perf.won }} />
          <span className="profits-losses-bar" style={{ flex: perf.lost }} />
        </div>
      </section>

      <section className="profits-results" aria-labelledby="pbot-picks-title">
        <header className="profits-results-heading">
          <div>
            <h2 id="pbot-picks-title">{view === 'ongoing' ? 'Picks for today' : 'Resolved picks'}</h2>
            <p>
              {view === 'ongoing'
                ? 'Open markets where the rules are satisfied right now.'
                : 'How the bot’s picks have settled, most recent first. Flat $100 per pick.'}
            </p>
          </div>
          <div className="pbot-controls">
            {view === 'ongoing' && (
              <div className="pbot-sort" role="group" aria-label="Sort picks">
                <button type="button" className={sort === 'recent' ? 'is-on' : ''} onClick={() => setSort('recent')}>Most recent</button>
                <button type="button" className={sort === 'profitable' ? 'is-on' : ''} onClick={() => setSort('profitable')}>Most profitable</button>
              </div>
            )}
            <label className="profits-filter">
              <select aria-label="Pick status" value={view} onChange={e => setView(e.target.value as 'ongoing' | 'resolved')}>
                <option value="ongoing">Ongoing</option>
                <option value="resolved">Resolved</option>
              </select>
              <ChevronDown size={15} aria-hidden="true" />
            </label>
          </div>
        </header>

        {view === 'resolved' && (
          <div className="profits-list-head" aria-hidden="true">
            <span>Market &amp; side</span>
            <span>Avg entry</span>
            <span>Result ($100)</span>
          </div>
        )}

        {view === 'ongoing' ? (
          picks.length === 0 ? (
            <p className="profits-notice">No markets meet the bar right now. This updates as tracked traders move.</p>
          ) : (
            <div className="expert-picks-grid">
              {[...picks]
                .sort((a, b) => sort === 'profitable'
                  ? Number(b.total_profit) - Number(a.total_profit)
                  : new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime())
                .map(o => (
                  <ExpertPickCard key={`${o.condition_id}::${o.outcome}`} opportunity={o} onOpen={() => setModalOpp(o)} payoutCta />
                ))}
            </div>
          )
        ) : (
          resolved.length === 0 ? (
            <p className="profits-notice">No Profit Bot picks have resolved yet.</p>
          ) : (
            <ol className="profits-result-list">
              {resolved.map(r => (
                <li className="profits-result-row" key={`${r.condition_id}:${r.outcome}:${r.resolved_ts}`}>
                  <div className="profits-position">
                    <h3>{r.title}</h3>
                    <div className="profits-trader-line">
                      <span>{r.outcome}</span>
                      <span>· {r.experts} proven traders</span>
                      <span>· {categoryLabel(r.category ?? 'other')}</span>
                    </div>
                  </div>
                  <div className="profits-entry"><strong>{Math.round(r.avg_entry * 100)}&cent;</strong><span>avg entry</span></div>
                  <div className="profits-result-value">
                    <strong className={r.pnl >= 0 ? 'is-positive' : 'is-negative'}>{fmtSigned(r.pnl)}</strong>
                    <span>
                      <span className={r.won ? 'is-positive' : 'is-negative'}>{r.won ? 'Won' : 'Lost'}</span>
                      {' · '}<time dateTime={r.resolved_ts}>{timeAgo(r.resolved_ts)}</time>
                    </span>
                  </div>
                </li>
              ))}
            </ol>
          )
        )}
      </section>

      {modalOpp && <SignalModal opportunity={modalOpp} onClose={() => setModalOpp(null)} />}
    </>
  )
}
