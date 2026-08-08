import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './app.css'

// Shown by ProtectedRoute in place of the dashboard when the signed-in
// user has no active subscription — stays on the app domain (rather than
// bouncing out to the marketing site) since they're already authenticated
// here. Deliberately self-contained rather than reusing landing/PricingPage
// — src/app must not import src/landing (see .dependency-cruiser.cjs) — so
// the plan copy here is a smaller, duplicated subset, not the full page.
const plans = [
  { name: 'Free', price: '$0', period: 'forever', desc: 'Your current plan.' },
  {
    name: 'Pro', price: '$49', period: 'per month', highlighted: true,
    desc: '7-day free trial, then billed monthly.',
    priceId: import.meta.env.VITE_STRIPE_PRICE_PRO_MONTHLY as string | undefined,
  },
  { name: 'Elite', price: 'Custom', period: 'contact us', desc: 'API access, dedicated account manager.' },
]

export default function PaywallPage() {
  const navigate = useNavigate()
  const [checkingOut, setCheckingOut] = useState(false)
  const [checkoutError, setCheckoutError] = useState<string | null>(null)
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null)

  useEffect(() => {
    if (checkoutUrl) window.location.href = checkoutUrl
  }, [checkoutUrl])

  const signOut = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const startCheckout = async (priceId: string) => {
    setCheckingOut(true)
    setCheckoutError(null)
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
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-header-logo">VisibleTrader</div>
          <button
            type="button"
            onClick={signOut}
            style={{
              marginLeft: 'auto', background: 'none', border: '1px solid rgba(248, 113, 113, 0.3)',
              borderRadius: 6, color: '#f87171', fontSize: '0.85rem', fontWeight: 600,
              padding: '0.4rem 0.85rem', cursor: 'pointer',
            }}
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="app-main" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', paddingTop: '3rem' }}>
        <h1 style={{ color: 'var(--text)', fontSize: '1.5rem', marginBottom: '0.4rem' }}>Choose a plan to continue</h1>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.9rem', marginBottom: '2rem' }}>
          Your account doesn't have an active subscription.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'center', maxWidth: 900 }}>
          {plans.map(plan => (
            <div
              key={plan.name}
              style={{
                background: 'var(--surface)', border: `1px solid ${plan.highlighted ? 'var(--gold)' : 'var(--border)'}`,
                borderRadius: 12, padding: '1.5rem', width: 260, textAlign: 'center',
              }}
            >
              <div style={{ color: 'var(--text)', fontWeight: 700, fontSize: '1.1rem', marginBottom: '0.4rem' }}>{plan.name}</div>
              <div style={{ color: 'var(--text)', fontSize: '1.75rem', fontWeight: 800 }}>{plan.price}</div>
              <div style={{ color: 'var(--text-faint)', fontSize: '0.78rem', marginBottom: '1rem' }}>{plan.period}</div>
              <p style={{ color: 'var(--text-dim)', fontSize: '0.85rem', marginBottom: '1.25rem', minHeight: 40 }}>{plan.desc}</p>

              {plan.priceId ? (
                <button
                  type="button"
                  onClick={() => startCheckout(plan.priceId!)}
                  disabled={checkingOut}
                  style={{
                    width: '100%', background: 'var(--gold)', color: '#15181f', border: 'none',
                    borderRadius: 6, padding: '0.6rem', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer',
                  }}
                >
                  {checkingOut ? 'Starting checkout…' : 'Start 7-day free trial'}
                </button>
              ) : plan.name === 'Elite' ? (
                <a
                  href="mailto:hello@visibletrader.io"
                  style={{
                    display: 'block', width: '100%', boxSizing: 'border-box', background: 'none', color: 'var(--text)',
                    border: '1px solid var(--border)', borderRadius: 6, padding: '0.6rem', fontWeight: 700,
                    fontSize: '0.85rem', textDecoration: 'none',
                  }}
                >
                  Contact us
                </a>
              ) : (
                <div style={{ color: 'var(--text-faint)', fontSize: '0.8rem', padding: '0.6rem' }}>Current plan</div>
              )}
            </div>
          ))}
        </div>

        {checkoutError && (
          <p style={{ color: '#f87171', fontSize: '0.85rem', marginTop: '1.5rem' }}>{checkoutError}</p>
        )}
      </main>
    </div>
  )
}
