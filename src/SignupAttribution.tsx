import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { getReferralCode } from './lib/domains'

// Runs on every authenticated app entry, including pricing, before onboarding.
// OAuth cannot send custom user metadata to Supabase: claim the referral on the
// first authenticated callback instead. The database finalizes even an empty
// referral, and refuses to change existing accounts on later sign-ins.
export default function SignupAttribution({ children }: { children: React.ReactNode }) {
  const resolvedUser = useRef<string | null | undefined>(undefined)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    let sequence = 0
    const capture = async () => {
      const current = ++sequence
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        if (data.session) {
          const result = await supabase.rpc('capture_signup_referral', { p_code: getReferralCode() })
          if (result.error) throw result.error
        }
        if (!cancelled && current === sequence) { resolvedUser.current = data.session?.user.id ?? null; setFailed(false); setReady(true) }
      } catch {
        if (!cancelled && current === sequence) { setReady(false); setFailed(true) }
      }
    }
    void capture()
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event !== 'SIGNED_IN' && event !== 'SIGNED_OUT') return
      if (resolvedUser.current === (session?.user.id ?? null)) return
      setReady(false)
      // Never await another auth call while inside Supabase's auth callback.
      setTimeout(() => { if (!cancelled) void capture() }, 0)
    })
    return () => { cancelled = true; data.subscription.unsubscribe() }
  }, [attempt])

  if (!ready) return <div role="status" style={{ padding: 40, color: '#cbd5e1', background: '#06070f', minHeight: '100vh' }}>
    {failed ? <>We couldn’t finish setting up your account. <button onClick={() => { setFailed(false); setAttempt(x => x + 1) }}>Try again</button></> : 'Loading…'}
  </div>
  return children
}
