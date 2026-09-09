import { useEffect, useState } from 'react'
import { Bot, ArrowUpRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmtFull, fmtSigned, timeAgo, marketUrl, categoryLabel } from './helpers'
import { CumulativeChart } from './PriceChart'

// The Profits page hero. Reads the profit_bot_* RPCs (see
// supabase/migrations/20260909060000_profit_bot.sql and _v2): a rules-based
// strategy over the tracked-trader data — act on a side only when 3+
// proven wallets (net-positive, >=52% win rate, >=20 resolved) are on it at
// 40-80c entry with >=$100 size. Same overview design as the raw
// all-traders numbers below it on the page.
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
  const [perf, setPerf] = useState<BotPerf | null>(null)
  const [daily, setDaily] = useState<BotDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [pi, pe, da] = await Promise.all([
        supabase.rpc('profit_bot_picks'),
        supabase.rpc('profit_bot_performance'),
        supabase.rpc('profit_bot_daily'),
      ])
      if (cancelled) return
      if (pi.error || pe.error || da.error) {
        setError(true)
      } else {
        setPicks((pi.data ?? []) as BotPick[])
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
  const sinceLabel = perf
    ? new Date(perf.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
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
          Following every tracked trader nets roughly break-even. Half the roster loses money and
          cancels out the rest. Profit Bot only acts on the narrow set of trades where the edge has held:
        </p>
        <ol className="pbot-rules-list">
          <li><strong>Proven traders only.</strong> The ~110 wallets (of ~470 tracked) that are net-positive, hit a 52%+ win rate, and have at least 20 resolved positions.</li>
          <li><strong>Consensus.</strong> At least 3 of those proven traders on the same side of the same market. One or two isn&rsquo;t a signal. Three-plus is where the win rate jumps.</li>
          <li><strong>Priced 40 to 80&cent;.</strong> Skips penny longshots and near-certain 90&cent;+ scalps. Both bleed money at scale.</li>
          <li><strong>Real size.</strong> The trader put at least $100 behind the position.</li>
        </ol>
        <p className="pbot-explain-foot">
          Backtested on every resolved position since {sinceLabel}: {perf.win_rate}% win rate,
          {' '}{flat100Pnl} on a flat $100 per pick. Past results don&rsquo;t predict future ones. Not financial advice.
        </p>
      </section>

      <section className="pbot" aria-labelledby="pbot-picks-title">
        <header className="pbot-head">
          <h2 id="pbot-picks-title">Picks for today</h2>
          <p className="pbot-rules">Open markets where the rules above are satisfied right now, freshest first.</p>
        </header>
        {picks.length === 0 ? (
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
        )}
      </section>
    </>
  )
}
