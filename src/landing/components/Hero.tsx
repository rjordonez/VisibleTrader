import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ProfitCard from './ProfitCard'
import DashboardPreview from './DashboardPreview'
import DashboardPreviewMobile from './DashboardPreviewMobile'
import { supabase } from '../../lib/supabase'

export default function Hero() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Capturing the lead is best-effort — a failed insert (network blip, RLS
  // hiccup) shouldn't trap someone who's ready to sign up on the landing
  // page. Email carries through as a query param so the signup form only
  // asks for a password, not the email again.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    await supabase.from('leads').insert({ email, source: 'hero_form' })
    navigate(`/signup?email=${encodeURIComponent(email)}`)
  }

  return (
    <section className="hero">

      {/* ── Two-column top ── */}
      <div className="hero-cols">
        {/* Left */}
        <div className="hero-copy">
          {/* Trust row (top) */}
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
            VisibleTrader watches the top-performing wallets on Polymarket in real time and
            surfaces what they're buying, the moment they buy it.
          </p>

          <form className="hero-form" onSubmit={submit}>
            <div className="hero-form-inner">
              <input
                type="email"
                placeholder="Your email..."
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? 'One sec…' : 'Get started free'}
              </button>
            </div>
          </form>
        </div>

        {/* Right: live signal preview card */}
        <div className="hero-card-wrap">
          <ProfitCard />
        </div>
      </div>

      {/* ── Dashboard preview ── */}
      <DashboardPreview />
      <DashboardPreviewMobile />

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
