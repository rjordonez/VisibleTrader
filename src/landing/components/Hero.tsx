import { useState } from 'react'
import ProfitCard from './ProfitCard'
import DashboardPreview from './DashboardPreview'

export default function Hero() {
  const [email, setEmail] = useState('')

  return (
    <section className="hero">

      {/* ── Two-column top ── */}
      <div className="hero-cols">
        {/* Left */}
        <div className="hero-copy">
          {/* Trust row — top */}
          <div className="hero-trust-row" style={{ marginBottom: '1.25rem' }}>
            <p className="hero-trust-text">
              Built on <strong>100% on-chain</strong> Polymarket trade data
            </p>
          </div>

          <h1>
            See what<br />
            <span>proven winners</span><br />
            are trading, live.
          </h1>

          <p className="hero-sub">
            Venter watches the top-performing wallets on Polymarket in real time and
            surfaces what they're buying — the moment they buy it.
          </p>

          <form
            className="hero-form"
            onSubmit={e => { e.preventDefault(); setEmail('') }}
          >
            <div className="hero-form-inner">
              <input
                type="email"
                placeholder="Your email..."
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
              <button type="submit" className="btn-primary">
                Get started free
              </button>
            </div>
          </form>
        </div>

        {/* Right — live signal preview card */}
        <div className="hero-card-wrap">
          <ProfitCard />
        </div>
      </div>

      {/* ── Dashboard preview ── */}
      <DashboardPreview />

      {/* ── Trust bar ── */}
      <div className="hero-trust-bar">
        {[
          '7-Day Free Trial',
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
