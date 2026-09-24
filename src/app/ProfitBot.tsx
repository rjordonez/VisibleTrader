import { useEffect, useState, useMemo } from 'react'
import { Cpu, ChevronDown, HelpCircle, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { useSubscriptionGate } from '../lib/subscriptionGate'
import { fmtFull, fmtSigned, timeAgo, categoryLabel } from './helpers'
import { CumulativePickChart } from './PickChart'
import { ExpertPickCard } from './ExpertPickCard'
import { SignalModal } from './SignalModal'
import type { Opportunity } from './types'

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
interface BotCurvePoint {
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

export default function ProfitBot() {
  // The hero (track record + chart) is genuinely public data now (see
  // 20260911040000_profit_bot_picks_public_teaser.sql) — it's proof, not
  // something to gate. The actual picks are the product, so only "Picks for
  // today" / "Resolved picks" stay behind the subscribe teaser.
  const { locked } = useSubscriptionGate()
  const [picks, setPicks] = useState<Opportunity[]>([])
  const [resolved, setResolved] = useState<BotResolved[]>([])
  const [curve, setCurve] = useState<BotCurvePoint[]>([])
  const [perf, setPerf] = useState<BotPerf | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [view, setView] = useState<'ongoing' | 'resolved'>('ongoing')
  const [sort, setSort] = useState<'recent' | 'profitable'>('recent')
  const [helpOpen, setHelpOpen] = useState(false)
  const [modalOpp, setModalOpp] = useState<Opportunity | null>(null)
  const betSize = 1000
  const betMultiplier = betSize / 100


  const [compoundStart, setCompoundStart] = useState(50)
  const COMPOUND_STAKE_FRACTION = 0.2
  
  const COMPOUND_MIN = 2.5
  const COMPOUND_MAX = 1000
  const compoundRatio = Math.log(COMPOUND_MAX / COMPOUND_MIN)
  const posFromValue = (v: number) => (1000 * Math.log(v / COMPOUND_MIN)) / compoundRatio
  const valueFromPos = (pos: number) => COMPOUND_MIN * Math.exp(compoundRatio * (pos / 1000))
  const compoundSliderPos = posFromValue(compoundStart)
  const compoundCurve = useMemo(() => {
    // `curve` is every resolved pick, oldest first. `resolved` is only the
    // latest 60 for the list, so it can't be used here.
    let bankroll = compoundStart
    const points: { d: string; cum: number }[] = []
    for (const p of curve) {
      const stake = bankroll * COMPOUND_STAKE_FRACTION
      bankroll = bankroll - stake + stake * (1 + Number(p.pnl) / 100)
      points.push({ d: p.resolved_ts, cum: bankroll })
    }
    return points
  }, [curve, compoundStart])
  const compoundFinal = compoundCurve.at(-1)?.cum ?? compoundStart
  const compoundHit100kAt = compoundCurve.findIndex(pt => pt.cum >= 100000)

  useEffect(() => {
    let cancelled = false
    let retry: ReturnType<typeof setTimeout> | undefined
    const load = async (attempt = 0) => {
      const [pi, re, pe, cu] = await Promise.all([
        supabase.rpc('profit_bot_picks'),
        supabase.rpc('profit_bot_resolved'),
        supabase.rpc('profit_bot_performance'),
        supabase.rpc('profit_bot_resolved_curve'),
      ])
      if (cancelled) return
      if (pi.error || re.error || pe.error || cu.error) {
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
        setCurve((cu.data ?? []) as BotCurvePoint[])
        setPerf(((pe.data ?? [])[0] ?? null) as BotPerf | null)
        setError(false)
      }
      setLoading(false)
    }
    void load()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60000)
    return () => { cancelled = true; clearInterval(t); clearTimeout(retry) }
  }, [])

  // `since` is a bare date; parse at midday so it doesn't shift a day back
  // in western timezones.
  const sinceLabel = perf
    ? new Date(`${perf.since}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : ''
  const scaledPnl = perf ? fmtSigned(perf.flat100_pnl * betMultiplier) : null

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
          <span className="pbot-badge"><Cpu size={12} aria-hidden="true" /> Profit Bot</span>
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
              {' '}{scaledPnl} on a flat {fmtFull(betSize)} per pick. Past results don&rsquo;t predict future ones. Not financial advice.
            </p>
          </div>
        )}

        <div className="pbot-betsize" role="group" aria-label="Starting bankroll">
          <label htmlFor="pbot-compound-slider">Starting amount</label>
          <div className="pbot-betsize-row">
            <div className="sig-range-track-wrap pbot-betsize-track">
              <div className="sig-range-track" />
              <div className="sig-range-fill" style={{ left: '0%', right: `${100 - compoundSliderPos / 10}%` }} />
              <input
                id="pbot-compound-slider"
                type="range"
                className="sig-range-input"
                min={0}
                max={1000}
                step={1}
                value={compoundSliderPos}
                onChange={e => setCompoundStart(Math.max(1, Math.round(valueFromPos(Number(e.target.value)))))}
              />
            </div>
            <span className="pbot-betsize-value">{fmtFull(compoundStart)}</span>
          </div>
        </div>

        <div className="profits-net-heading">
          <div>
            <h2 id="pbot-title">If you restaked {(COMPOUND_STAKE_FRACTION * 100).toFixed(0)}% of the bankroll every pick</h2>
            <strong className={`profits-net-value ${compoundFinal >= compoundStart ? 'is-positive' : 'is-negative'}`}>
              {fmtFull(compoundFinal)}
            </strong>
          </div>
          <div className="profits-net-context">
            <strong>{compoundHit100kAt >= 0 ? `Pick #${compoundHit100kAt + 1}` : 'Not yet'}</strong>
            <span>when it first crossed $100,000</span>
          </div>
        </div>

        <div className="profits-chart-area">
          <p className="profits-chart-label">
            Real sequence, real resolved picks since {sinceLabel}. {(COMPOUND_STAKE_FRACTION * 100).toFixed(0)}% of bankroll restaked each time, not a flat amount.
          </p>
          {compoundCurve.length > 1
            ? <CumulativePickChart data={compoundCurve} height={250} />
            : <p className="profits-notice">Not enough resolved picks yet.</p>}
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
          <div><dt>Restaked per pick</dt><dd>{(COMPOUND_STAKE_FRACTION * 100).toFixed(0)}% of bankroll</dd></div>
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
                : `How the bot’s picks have settled, most recent first. Flat ${fmtFull(betSize)} per pick.`}
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
            <span>Result ({fmtFull(betSize)})</span>
          </div>
        )}

        {view === 'ongoing' ? (
          // Each ExpertPickCard gates itself now (win rate + stats stay
          // visible, the title blurs, the bet button becomes a "Subscribe"
          // link) — see ExpertPickCard.tsx. No page-level blur needed here.
          picks.length === 0 ? (
            <p className="profits-notice">No markets meet the bar right now. This updates as tracked traders move.</p>
          ) : (
            <div className="expert-picks-grid">
              {[...picks]
                .sort((a, b) => sort === 'profitable'
                  ? Number(b.total_profit) - Number(a.total_profit)
                  : new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime())
                .map(o => (
                  <ExpertPickCard key={`${o.condition_id}::${o.outcome}`} opportunity={o} onOpen={() => setModalOpp(o)} />
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
                  {/* Per-row gate: whether it won or lost stays legible
                      (that's the proof), the exact payout is what's
                      blurred — same idea as the chart on ongoing picks. */}
                  <div className="profits-result-value">
                    <strong className={`${r.pnl >= 0 ? 'is-positive' : 'is-negative'} ${locked ? 'is-blurred' : ''}`}>{fmtSigned(r.pnl * betMultiplier)}</strong>
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
