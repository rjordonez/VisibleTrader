import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'
import PaywallPage from './PaywallPage'
import OnboardingPage from './OnboardingPage'

// Any status Stripe reports that should still count as "let them in" —
// trialing and active are the only ones; past_due/canceled/unpaid/etc all
// fall through to the pricing redirect below.
const ACTIVE_SUB_STATUSES = new Set(['trialing', 'active'])

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'authed' | 'anon'>('loading')
  const [subActive, setSubActive] = useState<boolean | null>(null)
  // Tracked separately from `status` (rather than read fresh off the
  // session each render) so OnboardingPage's onComplete can flip this
  // immediately instead of waiting on Supabase's auth-state-change event
  // to round-trip back after updateUser().
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setStatus(data.session ? 'authed' : 'anon')
      setOnboardingDone(data.session ? !!data.session.user.user_metadata?.onboarding_completed : null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setStatus(session ? 'authed' : 'anon')
      setOnboardingDone(session ? !!session.user.user_metadata?.onboarding_completed : null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (status !== 'authed') return
    let cancelled = false
    // Landing here straight off a successful Stripe checkout, the webhook
    // that actually writes the subscriptions row can still be a few
    // seconds behind the redirect — retry for a while instead of bouncing
    // a customer who just paid straight back to pricing on the first miss.
    const justCheckedOut = new URLSearchParams(window.location.search).get('checkout') === 'success'
    const maxAttempts = justCheckedOut ? 8 : 1
    let attempt = 0

    // No .eq(user_id, ...) needed — RLS on subscriptions already scopes this
    // to "auth.uid() = user_id", so this can only ever return the caller's
    // own row (or none).
    const check = () => {
      supabase.from('subscriptions').select('status').maybeSingle().then(({ data }) => {
        if (cancelled) return
        const active = !!data && ACTIVE_SUB_STATUSES.has(data.status)
        attempt++
        if (active || attempt >= maxAttempts) {
          setSubActive(active)
        } else {
          setTimeout(check, 1500)
        }
      })
    }
    check()
    return () => { cancelled = true }
  }, [status])

  if (status === 'loading' || (status === 'authed' && onboardingDone === null)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#06070f', color: '#6b7280', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '0.875rem' }}>
        Loading…
      </div>
    )
  }

  if (status === 'anon') {
    return <Navigate to="/login" replace />
  }

  if (!onboardingDone) {
    return <OnboardingPage onComplete={() => setOnboardingDone(true)} />
  }

  if (subActive === null) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#06070f', color: '#6b7280', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '0.875rem' }}>
        Loading…
      </div>
    )
  }

  if (!subActive) {
    // Stay on the app domain rather than bouncing out to marketing — show
    // the plans (and a way to sign out) right here instead.
    return <PaywallPage />
  }

  return <>{children}</>
}
