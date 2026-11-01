import { useState } from 'react'
import { Link } from 'react-router-dom'
import ProfitCard from './ProfitCard'
import WinnersPreview from './WinnersPreview'
import WinnersPreviewMobile from './WinnersPreviewMobile'
import { useLiveTradeCounter, RollingNumber } from '../../lib/RollingCounter'

// Unsplash License stock portraits (ZOPIJ2m7cPY, SNvrVyUYyK0, VdSd8u5N5Ic),
// not photos of real users. A slot whose file fails to load falls back to
// the initial-on-gradient avatar (.wp-avatar convention).
const avatars = [
  { src: '/avatars/1.jpg', initial: 'J', bg: 'linear-gradient(135deg, #ca8a04, #facc15)' },
  { src: '/avatars/2.jpg', initial: 'M', bg: 'linear-gradient(135deg, #9333ea, #c084fc)' },
  { src: '/avatars/3.jpg', initial: 'A', bg: 'linear-gradient(135deg, #0891b2, #22d3ee)' },
]

function Avatar({ src, initial, bg }: { src: string; initial: string; bg: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="hero-avatar" style={{ background: bg }}>{initial}</span>
  return <img className="hero-avatar" src={src} alt="" onError={() => setFailed(true)} />
}

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
              {avatars.map(a => <Avatar key={a.src} {...a} />)}
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
