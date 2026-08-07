import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from './lib/supabase'

// Any status Stripe reports that should still count as "let them in" —
// trialing and active are the only ones; past_due/canceled/unpaid/etc all
// fall through to the pricing redirect below.
const ACTIVE_SUB_STATUSES = new Set(['trialing', 'active'])

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<'loading' | 'authed' | 'anon'>('loading')
  const [subActive, setSubActive] = useState<boolean | null>(null)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setStatus(data.session ? 'authed' : 'anon')
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setStatus(session ? 'authed' : 'anon')
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (status !== 'authed') return
    let cancelled = false
    // No .eq(user_id, ...) needed — RLS on subscriptions already scopes this
    // to "auth.uid() = user_id", so this can only ever return the caller's
    // own row (or none).
    supabase.from('subscriptions').select('status').maybeSingle().then(({ data }) => {
      if (cancelled) return
      setSubActive(!!data && ACTIVE_SUB_STATUSES.has(data.status))
    })
    return () => { cancelled = true }
  }, [status])

  if (status === 'loading' || (status === 'authed' && subActive === null)) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#06070f', color: '#6b7280', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '0.875rem' }}>
        Loading…
      </div>
    )
  }

  if (status === 'anon') {
    return <Navigate to="/login" replace />
  }

  if (!subActive) {
    return <Navigate to="/pricing" replace />
  }

  return <>{children}</>
}
