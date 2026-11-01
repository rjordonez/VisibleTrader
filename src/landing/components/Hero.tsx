import { Link } from 'react-router-dom'
import ProfitCard from './ProfitCard'
import WinnersPreview from './WinnersPreview'
import WinnersPreviewMobile from './WinnersPreviewMobile'
import { useLiveTradeCounter, RollingNumber } from '../../lib/RollingCounter'

// Initial-on-gradient avatars, same convention as WinnersPreview's .wp-avatar,
// not photos standing in for specific real users.
const avatars = [
  { initial: 'J', bg: 'linear-gradient(135deg, #ca8a04, #facc15)' },
  { initial: 'M', bg: 'linear-gradient(135deg, #9333ea, #c084fc)' },
  { initial: 'A', bg: 'linear-gradient(135deg, #0891b2, #22d3ee)' },
]

export default function Hero() {
  const tradeCount = useLiveTradeCounter()

  return (
    <section className="hero">
      <img src="/hero-whale.png" alt="" aria-hidden="true" className="hero-whale-art" />
      <img src="/hero-astronaut.png" alt="" aria-hidden="true" className="hero-bg-art" />
      <div className="hero-rays" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => <div className="hero-ray" key={i} />)}
      </div>

      {/* ── Two-column top ── */}
      <div className="hero-cols">
        {/* Left */}
        <div className="hero-copy">
          {/* Trust row (top) */}
          <div className="hero-trust-row" style={{ marginBottom: '1.25rem' }}>
            <p className="hero-trust-text">
              {tradeCount === 0 ? (
                <>Built on <strong>100% on-chain</strong> Polymarket trade data</>
              ) : (
                <><strong><RollingNumber value={tradeCount} /></strong> real trades tracked, on-chain</>
              )}
            </p>
          </div>

          <h1>
            The #1 Whale Tracker To <em className="hero-h1-emphasis">Beat</em> Prediction Markets
          </h1>

          <p className="hero-headline-sub">See exactly who the insider traders and experts are, the moment they make a move.</p>

          <div className="hero-social">
            <div className="hero-avatars" aria-hidden="true">
              {avatars.map(a => (
                <span key={a.initial} className="hero-avatar" style={{ background: a.bg }}>{a.initial}</span>
              ))}
            </div>
            <span className="hero-social-text">Join 6k+ whale watchers</span>
          </div>

          <div className="hero-form">
            <Link to="/signup" className="btn-primary">Get started</Link>
          </div>
        </div>

        {/* Right: live signal preview card */}
        <div className="hero-card-wrap">
          <ProfitCard />
        </div>
      </div>

      {/* ── Dashboard preview ── */}
      <div className="demo-intro">
        <div className="demo-intro-eyebrow">REAL TRADES · REAL TIME</div>
        <h2 className="demo-intro-headline">this is what winning looks like.</h2>
        <p className="demo-intro-sub">A live feed of real, tracked wins — the moment they close.</p>
      </div>
      <WinnersPreview />
      <WinnersPreviewMobile />

      {/* ── Trust bar ── */}
      <div className="hero-trust-bar">
        {[
          '$1 First Week',
          'Real Wallets, Real Trades',
          'Polymarket',
          'Sub-Second Signal Latency',
        ].map(item => (
          <div key={item} className="hero-trust-item">
            <span className="hero-trust-check">✓</span>
            {item}
          </div>
        ))}
      </div>
    </section>
  )
}
