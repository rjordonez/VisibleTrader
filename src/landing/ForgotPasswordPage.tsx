import './landing.css'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    })
    setSubmitting(false)
    // Show the same "check your email" state either way — a failure here is
    // almost always "no account with that email," and confirming that back
    // to the submitter is an account-enumeration leak, same reasoning as
    // Supabase's own signup behavior.
    if (resetError) console.error('resetPasswordForEmail:', resetError.message)
    setSent(true)
  }

  if (sent) {
    return (
      <div className="auth-content">
        <div className="auth-card">
          <h1 className="auth-title">Check your email</h1>
          <p className="auth-sub">If an account exists for {email}, we sent a password reset link.</p>
          <p className="auth-foot"><Link to="/login">Back to log in</Link></p>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-content">
      <div className="auth-card">
        <h1 className="auth-title">Reset your password</h1>
        <p className="auth-sub">Enter your email and we'll send you a reset link.</p>

        <form className="auth-form" onSubmit={submit}>
          <label className="auth-label">Email</label>
          <input
            className="auth-input" type="email" placeholder="you@example.com"
            value={email} onChange={e => setEmail(e.target.value)} required
          />
          {error && <div style={{ color: '#f87171', fontSize: '0.82rem', marginTop: '0.6rem' }}>{error}</div>}
          <button type="submit" className="btn-primary auth-submit" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send reset link'}
          </button>
        </form>

        <p className="auth-foot">
          <Link to="/login">Back to log in</Link>
        </p>
      </div>
    </div>
  )
}
