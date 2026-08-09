import './landing.css'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { appUrl, marketingUrl } from '../lib/domains'

// const platformLogos = [
//   { name: 'Polymarket', src: '/polymarket.png' },
// ]

const plans = [
  {
    name: 'Pro',
    dayMonthly: '1.63',
    dayYearly: '1.30',
    fullMonthly: '1.63',
    desc: 'Everything you need to follow real trading activity, live.',
    features: [
      'Unlimited Live Ticker',
      'Full Vetted Picks with price charts',
      'Full Leaderboard + trader detail pages',
      'Profits page: real, payout-adjusted P&L',
      'Browser alerts on your watchlist',
      'Configurable roster size & conviction tiers',
      '24/7 live chat support',
    ],
    cta: 'Start 7-day free trial',
    href: appUrl('/signup'),
    priceIdMonthly: import.meta.env.VITE_STRIPE_PRICE_PRO_MONTHLY as string | undefined,
    priceIdYearly: import.meta.env.VITE_STRIPE_PRICE_PRO_YEARLY as string | undefined,
    highlighted: true,
  },
  {
    name: 'Elite',
    dayMonthly: '4.97',
    dayYearly: '3.97',
    fullMonthly: '4.97',
    desc: 'For serious traders who want the fastest, most granular access.',
    features: [
      'Everything in Pro',
      'API access',
      'Sub-second alert delivery',
      'Custom watchlists & conviction filters',
      'Dedicated account manager',
    ],
    cta: 'Contact us',
    href: 'mailto:hello@visibletrader.io',
    priceIdMonthly: undefined as string | undefined,
    priceIdYearly: undefined as string | undefined,
    highlighted: false,
  },
]

export default function PricingPage() {
  const [yearly, setYearly] = useState(true)
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)

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
      body: { price_id: priceId },
    })
    if (error || !data?.url) {
      setCheckingOut(false)
      setCheckoutError('Could not start checkout — please try again in a moment.')
      return
    }
    setCheckoutUrl(data.url)
  }

  return (
    <div className="pricing-content">
      <div className="pricing-header">
        <h1 className="pricing-title">Simple, transparent pricing</h1>
        <p className="pricing-sub">Pick the plan that fits how deep you want to go.</p>

        <div className="pricing-toggle">
          <button
            className={`pricing-toggle-btn ${!yearly ? 'active' : ''}`}
            onClick={() => setYearly(false)}
          >Monthly</button>
          <button
            className={`pricing-toggle-btn ${yearly ? 'active' : ''}`}
            onClick={() => setYearly(true)}
          >
            Yearly
            <span className="pricing-toggle-badge">Save 20%</span>
          </button>
        </div>
      </div>

      <div className="pricing-grid">
        {plans.map(plan => (
          <div key={plan.name} className={`pricing-card ${plan.highlighted ? 'pricing-card-pro' : ''}`}>
            {plan.highlighted && <div className="pricing-popular">Most popular</div>}
            <div className="pricing-plan-name">{plan.name}</div>

            {plan.dayMonthly ? (
              <div className="pricing-price-block">
                <div className="pricing-price-row">
                  <span className="pricing-day-price">
                    ${yearly ? plan.dayYearly : plan.dayMonthly}
                  </span>
                  {yearly && (
                    <span className="pricing-day-original">${plan.fullMonthly}</span>
                  )}
                </div>
                <div className="pricing-day-label">
                  per day, billed {yearly ? 'yearly' : 'monthly'}
                </div>
              </div>
            ) : (
              <div className="pricing-price-block">
                <div className="pricing-day-price">$0</div>
                <div className="pricing-day-label">free forever</div>
              </div>
            )}

            <p className="pricing-desc">{plan.desc}</p>

            {plan.priceIdMonthly && plan.priceIdYearly ? (
              <button
                type="button"
                className={`pricing-cta ${plan.highlighted ? 'pricing-cta-pro' : ''}`}
                onClick={() => startCheckout(yearly ? plan.priceIdYearly! : plan.priceIdMonthly!)}
                disabled={checkingOut}
              >
                {checkingOut ? 'Starting checkout…' : plan.cta}
              </button>
            ) : (
              <a href={plan.href} className={`pricing-cta ${plan.highlighted ? 'pricing-cta-pro' : ''}`}>
                {plan.cta}
              </a>
            )}
            {plan.highlighted && checkoutError && (
              <p style={{ color: '#f87171', fontSize: '0.8rem', marginTop: '0.5rem' }}>{checkoutError}</p>
            )}

            <ul className="pricing-features">
              {plan.features.map(f => (
                <li key={f} className="pricing-feature">
                  <span className="pricing-check">✓</span>
                  {f}
                </li>
              ))}
            </ul>

            {/* <div className="pricing-card-logos">
              {platformLogos.map(p => (
                <img key={p.name} src={p.src} alt={p.name} className="pricing-card-logo" />
              ))}
            </div> */}
          </div>
        ))}
      </div>

      <p className="pricing-fine">No contracts. Cancel anytime. 7-day free trial on Pro.</p>
    </div>
  )
}
