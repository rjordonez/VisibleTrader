import './landing.css'
import { useState, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import posthog from '../lib/posthog'
import OAuthButtons from './components/OAuthButtons'

export default function SignupPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // e.g. /signup?next=/pricing so a "start trial" click that requires an
  // account first lands back where it was headed instead of always the
  // dashboard root. `next` can be a full cross-origin URL now too — the
  // pricing page lives on the marketing domain, not here — so it's handled
  // as a real navigation (below) rather than always going through the
  // router. Only helps when email confirmation is off / already has a
  // session — the confirm-email path below has no way to carry this across
  // that round trip, so it just falls back to a manual return visit.
  const next = searchParams.get('next') || '/'
  const [email, setEmail] = useState(searchParams.get('email') || '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)
  const [redirectUrl, setRedirectUrl] = useState<string | null>(null)

  useEffect(() => {
    if (redirectUrl) window.location.href = redirectUrl
  }, [redirectUrl])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { data, error: signUpError } = await supabase.auth.signUp({ email, password })
    setSubmitting(false)
    if (signUpError) {
      setError(signUpError.message)
      return
    }
    // If email confirmation is on (Supabase default), there's no session yet,
    // so tell the user to check their inbox instead of silently doing nothing.
    if (!data.session) {
      posthog.capture('signup_completed', { method: 'password', email_confirmation_required: true })
      setConfirmSent(true)
      return
    }
    posthog.capture('signup_completed', { method: 'password', email_confirmation_required: false })
    if (next.startsWith('http')) setRedirectUrl(next)
    else navigate(next)
  }

  if (confirmSent) {
    return (
      <div className="auth-content">
        <div className="auth-card">
          <h1 className="auth-title">Check your email</h1>
          <p className="auth-sub">We sent a confirmation link to {email}. Click it, then log in.</p>
          <p className="auth-foot"><Link to="/login">Back to log in</Link></p>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-content">
      <div className="auth-card">
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-sub">Start free, upgrade whenever you're ready.</p>

        <OAuthButtons onError={setError} />

        <form className="auth-form" onSubmit={submit}>
          <label className="auth-label">Email</label>
          <input
            className="auth-input" type="email" placeholder="you@example.com"
            value={email} onChange={e => setEmail(e.target.value)} required
          />
          <label className="auth-label">Password</label>
          <input
            className="auth-input" type="password" placeholder="At least 8 characters"
            value={password} onChange={e => setPassword(e.target.value)} required minLength={8}
            autoFocus={!!searchParams.get('email')}
          />
          {error && <div style={{ color: '#f87171', fontSize: '0.82rem', marginTop: '0.6rem' }}>{error}</div>}
          <button type="submit" className="btn-primary auth-submit" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p className="auth-foot">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  )
}
