import { useEffect, useState } from 'react'
import { Bot, ArrowUpRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmtFull, fmtSigned, timeAgo, marketUrl, categoryLabel } from './helpers'

// Rendered at the top of the Profits page. Reads the two profit_bot_* RPCs
// (see supabase/migrations/20260909060000_profit_bot.sql): a rules-based
// strategy over the tracked-trader data — copy a side only when 3+ proven
// wallets (net-positive, >=52% win rate, >=20 resolved) are on it at 40-80c
// with real size.
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

export default function ProfitBot() {
  const [picks, setPicks] = useState<BotPick[]>([])
  const [perf, setPerf] = useState<BotPerf | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const [pi, pe] = await Promise.all([
        supabase.rpc('profit_bot_picks'),
        supabase.rpc('profit_bot_performance'),
      ])
      if (cancelled) return
      if (pi.error || pe.error) {
        setError(true)
      } else {
        setPicks((pi.data ?? []) as BotPick[])
        setPerf(((pe.data ?? [])[0] ?? null) as BotPerf | null)
        setError(false)
      }
      setLoading(false)
    }
    void load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60000)
    return () => { cancelled = true; clearInterval(t) }
  }, [])

  const sinceLabel = perf ? new Date(perf.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''

  return (
    <section className="pbot" aria-labelledby="pbot-title">
      <header className="pbot-head">
        <div className="pbot-title-row">
          <span className="pbot-badge"><Bot size={14} aria-hidden="true" /> Profit Bot</span>
          <h2 id="pbot-title">Picks for today</h2>
        </div>
        <p className="pbot-rules">
          Follows a side only when 3+ proven traders (net-positive, 52%+ win rate) land on it together at 40 to 80&cent; with real size.
        </p>
      </header>

      {perf && perf.picks > 0 && (
        <dl className="pbot-perf">
          <div><dt>Win rate</dt><dd>{perf.win_rate}%</dd></div>
          <div>
            <dt>Avg return per pick</dt>
            <dd className={perf.avg_return_pct >= 0 ? 'is-positive' : 'is-negative'}>
              {perf.avg_return_pct >= 0 ? '+' : ''}{perf.avg_return_pct}%
            </dd>
          </div>
          <div>
            <dt>$100 a pick since {sinceLabel}</dt>
            <dd className={perf.flat100_pnl >= 0 ? 'is-positive' : 'is-negative'}>{fmtSigned(perf.flat100_pnl)}</dd>
          </div>
          <div><dt>Resolved picks</dt><dd>{perf.picks.toLocaleString()}</dd></div>
        </dl>
      )}

      {loading ? (
        <div className="pbot-list" aria-busy="true">{[0, 1, 2].map(i => <div key={i} className="pbot-row-skel sig-skel" />)}</div>
      ) : error ? (
        <p className="profits-notice" role="status">Couldn&rsquo;t load Profit Bot right now. Retrying.</p>
      ) : picks.length === 0 ? (
        <p className="profits-notice">No markets meet the bar right now. This list updates as tracked traders move.</p>
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

      <p className="pbot-foot">
        Backtested on tracked-trader history, flat $100 per pick. Past results don&rsquo;t predict future ones. Not financial advice.
      </p>
    </section>
  )
}
