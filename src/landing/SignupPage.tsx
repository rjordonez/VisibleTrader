import './landing.css'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function SignupPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmSent, setConfirmSent] = useState(false)

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
      setConfirmSent(true)
      return
    }
    navigate('/app')
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
