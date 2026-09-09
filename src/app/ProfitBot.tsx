import { useEffect, useState } from 'react'
import { Bot, ArrowUpRight, ChevronDown } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmtFull, fmtSigned, timeAgo, marketUrl, categoryLabel } from './helpers'
import { CumulativeChart } from './PriceChart'

// The Profits page hero. Reads the profit_bot_* RPCs (see
// supabase/migrations/20260909060000_profit_bot.sql, _v2, _resolved): a
// rules-based strategy over the tracked-trader data — act on a side only
// when 3+ proven wallets (net-positive, >=52% win rate, >=20 resolved) are
// on it at 40-80c entry with >=$100 size.
interface BotPick {
  condition_id: string
  outcome: string
  title: string
  slug: string
  event_slug: string | null
  category: string | null
  experts: number
  avg_entry: number
  latest_price: number
  combined_stake: number
  last_entry: string
}
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
  const [picks, setPicks] = useState<BotPick[]>([])
  const [resolved, setResolved] = useState<BotResolved[]>([])
  const [perf, setPerf] = useState<BotPerf | null>(null)
  const [daily, setDaily] = useState<BotDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [view, setView] = useState<'ongoing' | 'resolved'>('ongoing')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [pi, re, pe, da] = await Promise.all([
        supabase.rpc('profit_bot_picks'),
        supabase.rpc('profit_bot_resolved'),
        supabase.rpc('profit_bot_performance'),
        supabase.rpc('profit_bot_daily'),
      ])
      if (cancelled) return
      if (pi.error || re.error || pe.error || da.error) {
        setError(true)
      } else {
        setPicks((pi.data ?? []) as BotPick[])
        setResolved((re.data ?? []) as BotResolved[])
        setPerf(((pe.data ?? [])[0] ?? null) as BotPerf | null)
        setDaily((da.data ?? []) as BotDay[])
        setError(false)
      }
      setLoading(false)
    }
    void load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  const cumulative = daily.reduce<{ d: string; cum: number }[]>((acc, day) => {
    acc.push({ d: day.d, cum: (acc.at(-1)?.cum ?? 0) + Number(day.day_pnl) })
    return acc
  }, [])
  // The `since` string is a bare date; parse at midday so it doesn't shift
  // a day backward in western timezones.
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
        </div>
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

      <section className="pbot-explain" aria-label="How the bot picks">
        <h2>How the bot picks</h2>
        <p>
          Following every tracked trader nets about break-even. Half the roster loses money and
          cancels out the rest. Profit Bot only acts where the edge has held:
        </p>
        <div className="pbot-rule-grid">
          <div className="pbot-rule">
            <span className="pbot-rule-n">1</span>
            <h3>Proven traders</h3>
            <p>The ~110 wallets (of ~470 tracked) that are net-positive with a 52%+ win rate over 20+ resolved bets.</p>
          </div>
          <div className="pbot-rule">
            <span className="pbot-rule-n">2</span>
            <h3>Consensus</h3>
            <p>3 or more of them on the same side of one market. Two isn&rsquo;t a signal. Three-plus is where the win rate jumps.</p>
          </div>
          <div className="pbot-rule">
            <span className="pbot-rule-n">3</span>
            <h3>Priced 40 to 80&cent;</h3>
            <p>Skips penny longshots and near-certain 90&cent;+ scalps. Both bleed money at scale.</p>
          </div>
          <div className="pbot-rule">
            <span className="pbot-rule-n">4</span>
            <h3>Real size</h3>
            <p>The trader put at least $100 behind the position.</p>
          </div>
        </div>
        <p className="pbot-explain-foot">
          Backtested on every resolved pick since {sinceLabel}: {perf.win_rate}% win rate,
          {' '}{flat100Pnl} on a flat $100 per pick. Past results don&rsquo;t predict future ones. Not financial advice.
        </p>
      </section>

      <section className="pbot" aria-labelledby="pbot-picks-title">
        <header className="pbot-head">
          <div>
            <h2 id="pbot-picks-title">{view === 'ongoing' ? 'Picks for today' : 'Resolved picks'}</h2>
            <p className="pbot-rules">
              {view === 'ongoing'
                ? 'Open markets where the rules are satisfied right now, freshest first.'
                : 'How the bot’s picks have settled, most recent first. Flat $100 per pick.'}
            </p>
          </div>
          <label className="profits-filter">
            <select aria-label="Pick status" value={view} onChange={e => setView(e.target.value as 'ongoing' | 'resolved')}>
              <option value="ongoing">Ongoing</option>
              <option value="resolved">Resolved</option>
            </select>
            <ChevronDown size={15} aria-hidden="true" />
          </label>
        </header>

        {view === 'ongoing' ? (
          picks.length === 0 ? (
            <p className="profits-notice">No markets meet the bar right now. This updates as tracked traders move.</p>
          ) : (
            <ol className="pbot-list">
              {picks.map(p => {
                const url = marketUrl(p.event_slug || p.slug)
                const entryC = Math.round(p.avg_entry * 100)
                const nowC = Math.round(p.latest_price * 100)
                const drift = nowC - entryC
                return (
                  <li className="pbot-row" key={`${p.condition_id}:${p.outcome}`}>
                    <div className="pbot-market">
                      <h3>{p.title}</h3>
                      <div className="pbot-sub">
                        <span className="pbot-side">{p.outcome}</span>
                        <span>{p.experts} proven traders</span>
                        <span>{categoryLabel(p.category ?? 'other')}</span>
                        <span>{fmtFull(p.combined_stake)} in</span>
                        <time dateTime={p.last_entry}>last buy {timeAgo(p.last_entry)}</time>
                      </div>
                    </div>
                    <div className="pbot-prices">
                      <div className="pbot-price"><strong>{entryC}&cent;</strong><span>avg entry</span></div>
                      <div className="pbot-price">
                        <strong>{nowC}&cent;</strong>
                        <span className={drift > 0 ? 'is-positive' : drift < 0 ? 'is-negative' : ''}>
                          {drift > 0 ? '+' : ''}{drift}&cent; now
                        </span>
                      </div>
                    </div>
                    {url && (
                      <a className="pbot-go" href={url} target="_blank" rel="noopener noreferrer" aria-label={`Open ${p.title} on Polymarket`}>
                        <ArrowUpRight size={16} aria-hidden="true" />
                      </a>
                    )}
                  </li>
                )
              })}
            </ol>
          )
        ) : (
          resolved.length === 0 ? (
            <p className="profits-notice">No Profit Bot picks have resolved yet.</p>
          ) : (
            <ol className="pbot-list">
              {resolved.map(r => (
                <li className="pbot-row is-resolved" key={`${r.condition_id}:${r.outcome}:${r.resolved_ts}`}>
                  <div className="pbot-market">
                    <h3>{r.title}</h3>
                    <div className="pbot-sub">
                      <span className="pbot-side">{r.outcome}</span>
                      <span>{r.experts} proven traders</span>
                      <span>{categoryLabel(r.category ?? 'other')}</span>
                      <span>{Math.round(r.avg_entry * 100)}&cent; avg entry</span>
                    </div>
                  </div>
                  <div className="pbot-result">
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
    </>
  )
}
