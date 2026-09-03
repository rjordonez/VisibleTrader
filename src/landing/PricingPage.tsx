import './landing.css'
import { useState, useEffect } from 'react'
import { Star, BadgeCheck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import posthog from '../lib/posthog'
import { appUrl, marketingUrl } from '../lib/domains'
import { hasGiftOffer } from '../lib/giftOffer'

// const platformLogos = [
//   { name: 'Polymarket', src: '/polymarket.png' },
// ]

const plans = [
  {
    name: 'Pro',
    badge: 'One win covers the month',
    introPrice: '1' as string | undefined,
    recurringPrice: '40' as string | undefined,
    dayPrice: undefined as string | undefined,
    desc: 'Everything you need to follow real trading activity, live.',
    features: [
      { bold: 'Unlimited Live Ticker', rest: '' },
      { bold: 'Expert Picks', rest: 'with full price charts' },
      { bold: 'Leaderboard', rest: '+ trader detail pages' },
      { bold: 'Profits page', rest: 'with real, payout-adjusted P&L' },
      { bold: 'Browser Alerts', rest: 'on your watchlist' },
      { bold: 'Configurable roster size', rest: '& conviction tiers' },
      { bold: '24/7 live chat support', rest: '' },
    ],
    cta: 'Start for $1',
    href: appUrl('/signup'),
    priceId: import.meta.env.VITE_STRIPE_PRICE_PRO_WEEKLY as string | undefined,
    highlighted: true,
  },
]

export default function PricingPage() {
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)
  // Set once on mount, not re-derived per render — a visitor who arrived via
  // a ?gift=1 link keeps the offer for this visit even if the param itself
  // isn't in the current URL (e.g. after returning from signup on the app
  // subdomain). See giftOffer.ts.
  const [isGift] = useState(() => hasGiftOffer())

  // The actual redirect is an effect, not inline in the handler below — a
  // full-page navigation is exactly the kind of external-system side effect
  // effects are for, same reasoning as this session's earlier Date.now()-in-
  // effect fixes. Doubles as the anonymous-user redirect and the
  // already-subscribed redirect below (both full navigations, cross-origin
  // over to the app subdomain).
  useEffect(() => {
    if (checkoutUrl) window.location.href = checkoutUrl
  }, [checkoutUrl])

  // A signed-in visitor who already has an active/trialing subscription
  // gets sent straight to the dashboard instead of seeing pricing at all —
  // deliberately not a "Manage subscription" link on this page, since that
  // surfaces a path toward cancellation right where they came to upgrade,
  // not what they're here for.
  useEffect(() => {
    let cancelled = false
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user || cancelled) return
      supabase.from('subscriptions').select('status').maybeSingle().then(({ data }) => {
        if (cancelled) return
        if (data && (data.status === 'trialing' || data.status === 'active')) {
          setCheckoutUrl(appUrl('/'))
        }
      })
    })
    return () => { cancelled = true }
  }, [])

  const startCheckout = async (priceId: string) => {
    setCheckingOut(true)
    setCheckoutError(null)
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      // Not signed in yet — sign up first, then come straight back here so
      // the same click-to-trial flow can pick up where it left off.
      setCheckoutUrl(appUrl(`/signup?next=${encodeURIComponent(marketingUrl('/pricing'))}`))
      return
    }
    const { data, error } = await supabase.functions.invoke('create-checkout-session', {
      body: { price_id: priceId, gift: isGift },
    })
    if (error || !data?.url) {
      setCheckingOut(false)
      setCheckoutError('Could not start checkout — please try again in a moment.')
      return
    }
    posthog.capture('checkout_started', { billing_interval: 'weekly' })
    setCheckoutUrl(data.url)
  }

  return (
    <div className="pricing-content">
      <div className="pricing-header">
        <h1 className="pricing-title">Simple, transparent pricing</h1>
        <p className="pricing-sub">Pick the plan that fits how deep you want to go.</p>
      </div>

      <div className="pricing-grid">
        {plans.map(plan => {
          // Only Pro has a gift variant — Elite has no self-serve checkout
          // (see plan.priceId below) and isGift never applies to it.
          const introPrice = plan.name === 'Pro' && isGift ? '0' : plan.introPrice
          const pct = introPrice && plan.recurringPrice
            ? Math.round((1 - Number(introPrice) / Number(plan.recurringPrice)) * 100)
            : null
          const cta = plan.name === 'Pro' && isGift ? 'Start for free' : plan.cta
          return (
          <div key={plan.name} className="pricing-plan-stack">
            <div className={`pricing-card pricing-card-glow ${plan.highlighted ? 'pricing-card-pro' : ''}`}>
              {plan.badge && <div className="pricing-badge">{plan.badge}</div>}

              <div className="pricing-plan-head">
                <div className="pricing-plan-icon">VT+</div>
                <div className="pricing-plan-name">{plan.name}</div>
              </div>

              <p className="pricing-desc">{plan.desc}</p>

              {introPrice ? (
                <div className="pricing-price-block">
                  <div className="pricing-price-row">
                    <span className="pricing-just">Just</span>
                    <span className="pricing-price-strike">${plan.recurringPrice}</span>
                    <span className="pricing-day-price">${introPrice}</span>
                    {pct !== null && <span className="pricing-discount-pill">-{pct}%</span>}
                  </div>
                  <div className="pricing-day-label">
                    first week, then ${plan.recurringPrice}/week
                  </div>
                </div>
              ) : (
                <div className="pricing-price-block">
                  <div className="pricing-price-row">
                    <span className="pricing-day-price">${plan.dayPrice}</span>
                  </div>
                  <div className="pricing-day-label">per day, billed monthly</div>
                </div>
              )}

              {plan.priceId ? (
                <button
                  type="button"
                  className={`pricing-cta ${plan.highlighted ? 'pricing-cta-pro' : ''}`}
                  onClick={() => startCheckout(plan.priceId!)}
                  disabled={checkingOut}
                >
                  {checkingOut ? 'Starting checkout…' : cta}
                </button>
              ) : (
                <a href={plan.href} className={`pricing-cta ${plan.highlighted ? 'pricing-cta-pro' : ''}`}>
                  {cta}
                </a>
              )}
              {plan.highlighted && checkoutError && (
                <p style={{ color: '#f87171', fontSize: '0.8rem', marginTop: '0.5rem' }}>{checkoutError}</p>
              )}

              <div className="hero-rating pricing-rating">
                <span className="hero-rating-stars">
                  {Array.from({ length: 5 }).map((_, i) => <Star key={i} size={13} fill="currentColor" strokeWidth={0} />)}
                </span>
                <span className="hero-rating-score">4.9/5</span>
                <span className="hero-rating-divider">|</span>
                <span className="hero-rating-verified"><BadgeCheck size={14} /> verified by Proof</span>
              </div>

              <div className="pricing-trust-row">
                <span>✓ Instant access</span>
                <span>✓ Cancel anytime</span>
                <span>✓ Secure checkout</span>
              </div>
            </div>

            <div className="pricing-card pricing-features-card">
              <ul className="pricing-features">
                {plan.features.map(f => (
                  <li key={f.bold} className="pricing-feature">
                    <span className="pricing-check">✓</span>
                    <span><strong>{f.bold}</strong>{f.rest ? ` ${f.rest}` : ''}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* <div className="pricing-card-logos">
              {platformLogos.map(p => (
                <img key={p.name} src={p.src} alt={p.name} className="pricing-card-logo" />
              ))}
            </div> */}
          </div>
          )
        })}
      </div>

      <p className="pricing-fine">No contracts. Cancel anytime.</p>
    </div>
  )
}
