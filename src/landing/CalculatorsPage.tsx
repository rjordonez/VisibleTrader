import { useState } from 'react'
import './landing.css'

/* ── Calculator widgets ── */

function EVCalc() {
  const [price, setPrice] = useState(45)
  const [prob, setProb]   = useState(55)
  const ev   = ((prob / 100) * (100 / price) - 1) * 100
  const good = ev > 0
  return (
    <div className="calc-widget">
      <div className="calc-fields">
        <label className="calc-label"><span>Contract Price (¢)</span><input className="calc-input" type="number" min={1} max={99} value={price} onChange={e => setPrice(+e.target.value)} /></label>
        <label className="calc-label"><span>Your Probability (%)</span><input className="calc-input" type="number" min={1} max={99} value={prob} onChange={e => setProb(+e.target.value)} /></label>
      </div>
      <div className={`calc-result ${good ? 'calc-result-green' : 'calc-result-red'}`}>
        <div className="calc-result-label">Expected Value</div>
        <div className="calc-result-value">{ev >= 0 ? '+' : ''}{ev.toFixed(2)}%</div>
        <div className="calc-result-note">{good ? 'Positive edge, worth taking.' : 'Negative edge, avoid this contract.'}</div>
      </div>
    </div>
  )
}

function ArbCalc() {
  const [yesPrice, setYes] = useState(62)
  const [noPrice, setNo]   = useState(41)
  const stake = 100
  const total  = yesPrice + noPrice
  const profit = total < 100 ? ((100 - total) / total) * 100 : null
  const yesBet = profit !== null ? (stake * noPrice  / total) : 0
  const noBet  = profit !== null ? (stake * yesPrice / total) : 0
  return (
    <div className="calc-widget">
      <div className="calc-fields">
        <label className="calc-label"><span>YES Price (¢)</span><input className="calc-input" type="number" min={1} max={99} value={yesPrice} onChange={e => setYes(+e.target.value)} /></label>
        <label className="calc-label"><span>NO Price (¢)</span><input className="calc-input" type="number" min={1} max={99} value={noPrice} onChange={e => setNo(+e.target.value)} /></label>
      </div>
      {profit !== null ? (
        <div className="calc-result calc-result-green">
          <div className="calc-result-label">Guaranteed Profit</div>
          <div className="calc-result-value">+{profit.toFixed(2)}%</div>
          <div className="calc-result-note">Bet ${yesBet.toFixed(2)} on YES · ${noBet.toFixed(2)} on NO</div>
        </div>
      ) : (
        <div className="calc-result calc-result-red">
          <div className="calc-result-label">No Arbitrage</div>
          <div className="calc-result-value">{total}¢ combined</div>
          <div className="calc-result-note">Prices must sum to under 100¢ for a guaranteed profit.</div>
        </div>
      )}
    </div>
  )
}

function KellyCalc() {
  const [bankroll, setBankroll] = useState(1000)
  const [edge, setEdge]         = useState(8)
  const [winProb, setWinProb]   = useState(55)
  const p = winProb / 100
  const q = 1 - p
  const b = (100 / (100 - winProb)) - 1
  const kelly   = Math.max(0, (p * b - q) / b)
  const fraction = Math.min(kelly, edge / 100)
  const betSize  = bankroll * fraction
  return (
    <div className="calc-widget">
      <div className="calc-fields">
        <label className="calc-label"><span>Bankroll ($)</span><input className="calc-input" type="number" min={1} value={bankroll} onChange={e => setBankroll(+e.target.value)} /></label>
        <label className="calc-label"><span>Win Probability (%)</span><input className="calc-input" type="number" min={1} max={99} value={winProb} onChange={e => setWinProb(+e.target.value)} /></label>
        <label className="calc-label"><span>Edge Cap (%)</span><input className="calc-input" type="number" min={0} max={50} value={edge} onChange={e => setEdge(+e.target.value)} /></label>
      </div>
      <div className="calc-result calc-result-green">
        <div className="calc-result-label">Optimal Bet Size</div>
        <div className="calc-result-value">${betSize.toFixed(2)}</div>
        <div className="calc-result-note">{(fraction * 100).toFixed(1)}% of bankroll · Half-Kelly: ${(betSize / 2).toFixed(2)}</div>
      </div>
    </div>
  )
}

function OddsConverter() {
  const [mode, setMode] = useState<'prob' | 'decimal' | 'american'>('prob')
  const [val, setVal]   = useState(55)
  let prob = 0, decimal = 0, american = 0
  try {
    if (mode === 'prob') {
      prob = val; decimal = 100 / val; american = val >= 50 ? -(val / (100 - val)) * 100 : ((100 - val) / val) * 100
    } else if (mode === 'decimal') {
      prob = 100 / val; decimal = val; american = val >= 2 ? (val - 1) * 100 : -100 / (val - 1)
    } else {
      if (val > 0) { prob = 100 / (val / 100 + 1); decimal = val / 100 + 1 }
      else { prob = Math.abs(val) / (Math.abs(val) + 100) * 100; decimal = 100 / Math.abs(val) + 1 }
      american = val
    }
  } catch {
    // ignore malformed input, fields just show 0
  }
  return (
    <div className="calc-widget">
      <div className="calc-fields">
        <label className="calc-label">Format<select className="calc-input" value={mode} onChange={e => setMode(e.target.value as typeof mode)}><option value="prob">Implied Probability (%)</option><option value="decimal">Decimal Odds</option><option value="american">American Odds</option></select></label>
        <label className="calc-label"><span>Value</span><input className="calc-input" type="number" value={val} onChange={e => setVal(+e.target.value)} /></label>
      </div>
      <div className="calc-result calc-result-neutral">
        <div className="calc-convert-grid">
          <div><div className="calc-convert-val">{prob.toFixed(1)}%</div><div className="calc-convert-lbl">Implied Prob</div></div>
          <div><div className="calc-convert-val">{decimal.toFixed(3)}</div><div className="calc-convert-lbl">Decimal</div></div>
          <div><div className="calc-convert-val">{american >= 0 ? '+' : ''}{american.toFixed(0)}</div><div className="calc-convert-lbl">American</div></div>
        </div>
      </div>
    </div>
  )
}

function NoVigCalc() {
  const [yes, setYes] = useState(55)
  const [no, setNo]   = useState(52)
  const total   = yes + no
  const trueYes = yes / total * 100
  const trueNo  = no  / total * 100
  const vig     = (total - 100) / total * 100
  return (
    <div className="calc-widget">
      <div className="calc-fields">
        <label className="calc-label"><span>YES Price (¢)</span><input className="calc-input" type="number" min={1} max={99} value={yes} onChange={e => setYes(+e.target.value)} /></label>
        <label className="calc-label"><span>NO Price (¢)</span><input className="calc-input" type="number" min={1} max={99} value={no} onChange={e => setNo(+e.target.value)} /></label>
      </div>
      <div className="calc-result calc-result-neutral">
        <div className="calc-convert-grid">
          <div><div className="calc-convert-val">{trueYes.toFixed(1)}%</div><div className="calc-convert-lbl">True YES prob</div></div>
          <div><div className="calc-convert-val">{trueNo.toFixed(1)}%</div><div className="calc-convert-lbl">True NO prob</div></div>
          <div><div className="calc-convert-val">{vig.toFixed(2)}%</div><div className="calc-convert-lbl">Platform edge</div></div>
        </div>
      </div>
    </div>
  )
}

function PromoCalc() {
  const [bonus, setBonus]       = useState(200)
  const [rollover, setRollover] = useState(1)
  const [winProb, setWinProb]   = useState(50)
  const required  = bonus * rollover
  const ev        = bonus - required * (1 - winProb / 100)
  const hedgeStake = bonus * (winProb / 100)
  return (
    <div className="calc-widget">
      <div className="calc-fields">
        <label className="calc-label"><span>Bonus Amount ($)</span><input className="calc-input" type="number" min={0} value={bonus} onChange={e => setBonus(+e.target.value)} /></label>
        <label className="calc-label"><span>Rollover (×)</span><input className="calc-input" type="number" min={1} step={0.5} value={rollover} onChange={e => setRollover(+e.target.value)} /></label>
        <label className="calc-label"><span>Win Probability (%)</span><input className="calc-input" type="number" min={1} max={99} value={winProb} onChange={e => setWinProb(+e.target.value)} /></label>
      </div>
      <div className={`calc-result ${ev > 0 ? 'calc-result-green' : 'calc-result-red'}`}>
        <div className="calc-result-label">Bonus EV</div>
        <div className="calc-result-value">${ev.toFixed(2)}</div>
        <div className="calc-result-note">Rollover required: ${required.toFixed(0)} · Hedge stake: ${hedgeStake.toFixed(2)}</div>
      </div>
    </div>
  )
}

/* ── Content per calculator ── */

const calcs = [
  {
    id: 'ev', name: 'EV Calculator',
    component: EVCalc,
    howTo: `The VisibleTrader EV Calculator tells you whether a prediction market contract is worth buying. Enter the current contract price (in cents) and your estimated true probability of the event happening. The calculator shows your expected profit or loss per $1 wagered.

A contract priced at 45¢ with a true probability of 55% has a positive expected value of +22.2%. Over many trades, consistently finding and taking +EV positions is the entire basis of profitable prediction market trading.

The formula is: EV = (true probability × profit if win) − (1 − true probability) × cost. If EV is positive, the contract is underpriced relative to your model. If negative, the market is overpricing the event.

Use this calculator to sanity-check a contract's price against your own probability estimate before trading.`,
    faqs: [
      { q: 'What does positive EV mean?', a: 'Positive expected value means the contract is priced below its true probability. Over many trades, +EV bets generate profit even though individual outcomes are uncertain.' },
      { q: 'How do I estimate true probability?', a: 'Use news, base rates, or your own research. The no-vig calculator can also extract implied probabilities from two-sided markets.' },
      { q: 'How much EV is worth trading?', a: 'Most serious traders look for at least +3–5% EV before entering a position, accounting for liquidity and transaction costs.' },
    ],
  },
  {
    id: 'arbitrage', name: 'Arbitrage Calculator',
    component: ArbCalc,
    howTo: `Arbitrage (arb) in prediction markets occurs when the same event is priced differently on two platforms. If Kalshi prices YES at 62¢ and Polymarket prices NO at 41¢, the combined cost is only 103¢, but both sides together guarantee a $1 payout. You've locked in 3¢ of profit per $1 staked, regardless of outcome.

Enter the YES price on one platform and the NO price on another. The calculator tells you whether an arb exists and how to split your stake for maximum guaranteed return.

The formula: profit % = (100 − YES − NO) / (YES + NO) × 100. Stakes split proportionally: YES stake = total × NO price / (YES + NO).

Spreads like this can close within seconds once other traders notice them, so cross-check live prices on each platform right before you place both legs.`,
    faqs: [
      { q: 'Is arbitrage risk-free?', a: 'Yes, as long as both trades execute before prices move. The main risk is price slippage between placing the two legs.' },
      { q: 'How often do arb opportunities appear?', a: 'It varies widely by platform liquidity and market volatility. There\'s no fixed rate, and they tend to close quickly once noticed.' },
      { q: 'Do platforms allow arbitrage?', a: 'Prediction market platforms generally allow arb trading since it improves price discovery. Unlike sportsbooks, they rarely limit winners.' },
    ],
  },
  {
    id: 'kelly', name: 'Kelly Criterion',
    component: KellyCalc,
    howTo: `The Kelly Criterion is a formula that tells you the mathematically optimal fraction of your bankroll to bet on a given edge. Betting too little leaves money on the table. Betting too much increases the risk of ruin.

Enter your bankroll, your estimated win probability, and your edge percentage. The calculator returns the full Kelly stake and the more conservative half-Kelly, which most professional traders use in practice.

The formula: f = (p × b − q) / b, where p is win probability, q = 1 − p, and b is the net odds received. For prediction markets, b = (1 − price) / price.

Most professionals use half-Kelly to smooth variance while retaining most of the growth benefit.`,
    faqs: [
      { q: 'Why use half-Kelly instead of full Kelly?', a: 'Full Kelly maximizes long-run growth but produces large drawdowns. Half-Kelly gives roughly 75% of the growth with much lower volatility.' },
      { q: 'What if my edge estimate is wrong?', a: "Overestimating your edge leads to overbetting. Many traders apply a discount factor (0.5x–0.75x) to account for model uncertainty." },
      { q: 'Should I always follow Kelly?', a: 'Kelly is a guide, not a rule. Liquidity limits, correlation between bets, and bankroll goals all affect optimal sizing in practice.' },
    ],
  },
  {
    id: 'odds', name: 'Odds Converter',
    component: OddsConverter,
    howTo: `Prediction markets quote prices in cents (implied probability). Traditional sportsbooks use American or decimal odds. This calculator converts between all three formats instantly.

Implied probability is the most natural format for prediction markets: a 55¢ contract implies a 55% chance of resolving YES. Decimal odds express the total return per $1 wagered (1.82 at 55¢). American odds show the profit on a $100 bet (+82 at 55¢).

Use this calculator when comparing prediction market prices against external probability estimates expressed in different formats.`,
    faqs: [
      { q: 'What is implied probability?', a: 'Implied probability is the market\'s estimate of an event\'s likelihood, expressed as a percentage. A 62¢ YES contract implies a 62% chance the event resolves YES.' },
      { q: 'How do decimal odds work?', a: 'Decimal odds represent total return including stake. Odds of 1.82 mean a $1 bet returns $1.82 total (82¢ profit) if you win.' },
      { q: 'Why do American odds have a + or −?', a: 'Positive American odds (+110) show profit on a $100 bet. Negative odds (−110) show how much you must bet to profit $100.' },
    ],
  },
  {
    id: 'no-vig', name: 'No-Vig Calculator',
    component: NoVigCalc,
    howTo: `Prediction market platforms build a margin into two-sided markets. If YES is priced at 55¢ and NO at 52¢, the combined price is 107¢, meaning the platform collects 7¢ per $1 resolved. The no-vig calculator strips this margin to reveal the true implied probabilities.

Enter both sides of a market. The calculator removes the platform's edge and outputs the fair-value probability for each side. This is especially useful when comparing a market's true odds against your own probability model.

Formula: true YES prob = YES price / (YES + NO). True NO prob = NO price / (YES + NO).`,
    faqs: [
      { q: 'Why does the no-vig price matter?', a: 'The no-vig price tells you what the market actually believes, without the platform\'s cut obscuring the signal.' },
      { q: 'How do I use no-vig odds to find edge?', a: 'Compare the no-vig probability to your own estimate. If your model says 60% and the market\'s no-vig is 52%, you have an 8% edge.' },
      { q: 'What is a typical vig on prediction markets?', a: 'Platform margins vary from 1–2% on liquid markets to 5–10% on thin or exotic markets. Kalshi and Polymarket typically run 2–5%.' },
    ],
  },
  {
    id: 'promo', name: 'Promo Calculator',
    component: PromoCalc,
    howTo: `Prediction market platforms offer sign-up bonuses and deposit matches to attract new users. The promo calculator tells you the real dollar value of a bonus after accounting for rollover requirements.

A $200 bonus with a 1x rollover means you must trade $200 before withdrawing. If you wager that $200 on a 50% probability event, the expected value of the bonus is $100. Hedging the required trades with +EV positions extracts maximum value.

Enter the bonus amount, rollover multiplier, and expected win probability on your hedge trades. The calculator returns the EV of the bonus and a suggested hedge stake.

Work through the calculator before committing to a bonus so you know the required trades in advance, rather than discovering the rollover terms mid-way through.`,
    faqs: [
      { q: 'Are platform bonuses actually profitable?', a: 'Often yes: most sign-up bonuses on prediction market platforms have positive expected value when combined with smart rollover trades, though the exact value depends on the specific terms.' },
      { q: 'What is a rollover requirement?', a: 'A rollover (or playthrough) requires you to trade a multiple of the bonus before withdrawing. A 1x rollover on a $200 bonus means you must trade $200.' },
      { q: 'Can I use arbitrage to meet rollover?', a: 'Often yes: if a platform allows multi-leg trades, you can use arb to fulfill rollover requirements with near-zero risk while retaining the full bonus value.' },
    ],
  },
]

function FAQ({ faqs }: { faqs: { q: string; a: string }[] }) {
  const [open, setOpen] = useState<number | null>(null)
  return (
    <div className="calc-faq">
      <h3 className="calc-section-title">Frequently Asked Questions</h3>
      <div className="faq-list blog-answers-list">
        {faqs.map((f, i) => (
          <div key={i} className="faq-item">
            <button className="faq-question" onClick={() => setOpen(open === i ? null : i)}>
              <svg className={`faq-chevron ${open === i ? 'open' : ''}`} width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {f.q}
            </button>
            {open === i && <div className="faq-answer">{f.a}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

function CTAStrip() {
  const [email, setEmail] = useState('')
  return (
    <div className="calc-cta-strip">
      <div>
        <div className="calc-cta-title">Less work, more profit.</div>
        <div className="calc-cta-sub">Upgrade for real-time +EV and arbitrage alerts across every platform.</div>
      </div>
      <form className="calc-cta-form" onSubmit={e => { e.preventDefault(); setEmail('') }}>
        <input className="calc-input" type="email" placeholder="Your email" value={email} onChange={e => setEmail(e.target.value)} required />
        <button type="submit" className="btn-primary">Get started</button>
      </form>
    </div>
  )
}

export default function CalculatorsPage() {
  const [active, setActive] = useState('ev')
  const current = calcs.find(c => c.id === active)!

  return (
    <div className="calc-page">
      {/* Sidebar */}
      <aside className="calc-sidebar">
        <div className="calc-sidebar-label">Calculators</div>
        {calcs.map(c => (
          <button key={c.id} className={`calc-sidebar-item ${active === c.id ? 'active' : ''}`} onClick={() => setActive(c.id)}>
            {c.name}
          </button>
        ))}
      </aside>

      {/* Main */}
      <main className="calc-main">
        <h1 className="calc-title">{current.name}</h1>

        <current.component />

        <CTAStrip />

        <div className="calc-how-to">
          <h3 className="calc-section-title">How to Use the {current.name}</h3>
          {current.howTo.split('\n\n').map((p, i) => (
            <p key={i} className="calc-how-to-p">{p}</p>
          ))}
        </div>

        <FAQ faqs={current.faqs} />
      </main>
    </div>
  )
}
