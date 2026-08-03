import './landing.css'
import { useState } from 'react'

const platformLogos = [
  { name: 'Polymarket', src: '/polymarket.png' },
]

const plans = [
  {
    name: 'Free',
    dayMonthly: null,
    dayYearly: null,
    fullMonthly: null,
    desc: 'Get started and see real tracked-wallet activity for yourself.',
    features: [
      'Live Ticker (delayed)',
      'Vetted Picks (top 3/day)',
      'Leaderboard, read-only',
      'Discord community access',
    ],
    cta: 'Get started free',
    href: '/signup',
    highlighted: false,
  },
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
    href: '/signup',
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
    highlighted: false,
  },
]

export default function PricingPage() {
  const [yearly, setYearly] = useState(true)

  return (
    <div className="pricing-content">
      <div className="pricing-header">
        <h1 className="pricing-title">Simple, transparent pricing</h1>
        <p className="pricing-sub">Start free. Upgrade when you're ready to go all in.</p>

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

            <a href={plan.href} className={`pricing-cta ${plan.highlighted ? 'pricing-cta-pro' : ''}`}>
              {plan.cta}
            </a>

            <ul className="pricing-features">
              {plan.features.map(f => (
                <li key={f} className="pricing-feature">
                  <span className="pricing-check">✓</span>
                  {f}
                </li>
              ))}
            </ul>

            <div className="pricing-card-logos">
              {platformLogos.map(p => (
                <img key={p.name} src={p.src} alt={p.name} className="pricing-card-logo" />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="pricing-fine">No contracts. Cancel anytime. 7-day free trial on Pro.</p>
    </div>
  )
}
