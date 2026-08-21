import { useNavigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import posthog from './lib/posthog'
import PricingPage from './landing/PricingPage'

// Shown by ProtectedRoute for a signed-in user with no active subscription
// — stays on the app domain rather than bouncing out to marketing. Lives
// at the repo root, not inside src/app or src/landing, specifically so it
// can import from both (same reasoning App.tsx already relies on for the
// auth pages — see .dependency-cruiser.cjs, which only constrains files
// actually inside those two folders). Reuses the real PricingPage
// component so this looks and behaves identically to the marketing
// pricing page — its startCheckout already goes straight to Stripe for an
// authenticated user instead of redirecting to sign up.
export default function PaywallPage() {
  const navigate = useNavigate()

  const signOut = async () => {
    posthog.capture('signed_out', { location: 'paywall' })
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '1.25rem 2rem 0' }}>
        <button
          type="button"
          onClick={signOut}
          style={{
            background: 'none', border: '1px solid rgba(248, 113, 113, 0.3)', borderRadius: 6,
            color: '#f87171', fontSize: '0.85rem', fontWeight: 600, padding: '0.4rem 0.85rem', cursor: 'pointer',
          }}
        >
          Sign out
        </button>
      </div>
      <PricingPage />
    </div>
  )
}
