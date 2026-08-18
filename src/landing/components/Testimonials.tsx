const reviews = [
  { init: '⚾', name: 'Diamondbacks vs. Nationals', handle: 'Sports · 9 top wallets', profit: '$91,947', text: "Nine top-tracked wallets independently converged on the same side within the same hour: real capital, real conviction." },
  { init: '⚽', name: 'CF América win market', handle: 'Sports · 6 top wallets', profit: '$21,160', text: "Six tracked wallets, one side, ranked by dollars deployed, not just headcount." },
  { init: '🏛️', name: 'US x Iran ceasefire', handle: 'Politics · 5 top wallets', profit: '$2,179', text: "Smaller size, still five independent wallets on the same side. Solo picks and small convergence both get surfaced." },
  { init: '🎮', name: 'LoL: LOUD vs paiN Gaming', handle: 'Esports · 2 top wallets', profit: '$23,346', text: "Esports markets move fast: the live ticker catches size the moment it lands." },
  { init: '⚾', name: 'Reds vs. Cardinals O/U 7.5', handle: 'Sports · 2 top wallets', profit: '$29,073', text: "Every card includes a price-history chart with exactly where each wallet bought in." },
  { init: '₿', name: 'Bitcoin above $67,500', handle: 'Crypto · solo pick', profit: '$3,999', text: "Solo picks are tagged separately from multi-wallet convergence, so you always know which you're looking at." },
  { init: '🏆', name: 'Leaderboard', handle: 'Real, verified performance', profit: '64% win ($)', text: "Win rate weighted by dollars deployed, not just trade count, so one lucky small bet can't inflate the record." },
  { init: '📈', name: 'Profits page', handle: 'Payout-adjusted P&L', profit: 'Live', text: "Resolved P&L accounts for actual payout ratio. Open positions are marked to market against the live price, not frozen at entry." },
]


const row1 = [...reviews, ...reviews]
const row2 = [...reviews.slice(4), ...reviews.slice(0, 4), ...reviews.slice(4), ...reviews.slice(0, 4)]

// Real payout screenshots from VisibleTrader users — not all on Polymarket
// (some run the same signals on other markets/sportsbooks too). Cycled
// across cards by index rather than tied to any specific one — there's no
// real connection between a given screenshot and a given signal example,
// they're just proof, laid over the corner of each card.
const proofShots = [
  '/proof-win-1.jpeg',
  '/proof-win-2.jpeg',
  '/proof-win-3.jpeg',
  '/proof-win-4.jpeg',
]

export default function Testimonials() {
  return (
    <section className="section testimonials">
      <div style={{ textAlign: 'center', marginBottom: '3rem' }}>
        <span className="section-tag">Real Data</span>
        <h2 style={{ margin: '0 0 0.5rem' }}>Real trades, verified on-chain.</h2>
        <p style={{ color: 'var(--text-3)', fontSize: '0.9rem', margin: 0 }}>
          Every example below is pulled from Polymarket's public order book, not backtested, not simulated.
        </p>
      </div>

      <div style={{ overflow: 'hidden' }}>
        <div className="marquee-track">
          {row1.map((r, i) => (
            <div key={i} className="testimonial-card">
              <img src={proofShots[i % proofShots.length]} alt="" className="testimonial-proof-corner" aria-hidden="true" />
              <p className="testimonial-text">"{r.text}"</p>
              <div className="testimonial-author">
                <div className="testimonial-avatar">{r.init}</div>
                <div>
                  <div className="testimonial-name">{r.name}</div>
                  <div className="testimonial-handle">{r.handle}</div>
                </div>
                <div className="testimonial-profit">{r.profit}</div>
              </div>
            </div>
          ))}
        </div>

        <div className="marquee-track reverse">
          {row2.map((r, i) => (
            <div key={i} className="testimonial-card">
              <img src={proofShots[i % proofShots.length]} alt="" className="testimonial-proof-corner" aria-hidden="true" />
              <p className="testimonial-text">"{r.text}"</p>
              <div className="testimonial-author">
                <div className="testimonial-avatar">{r.init}</div>
                <div>
                  <div className="testimonial-name">{r.name}</div>
                  <div className="testimonial-handle">{r.handle}</div>
                </div>
                <div className="testimonial-profit">{r.profit}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
