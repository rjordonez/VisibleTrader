import './landing.css'
import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function ResetPasswordPage() {
  const navigate = useNavigate()
  // The reset-link redirect lands here with a recovery token in the URL;
  // the Supabase client reads it automatically (detectSessionInUrl) and
  // fires PASSWORD_RECOVERY once that session is established — until then
  // there's nothing valid to submit a new password against.
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setReady(true)
    })
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: updateError } = await supabase.auth.updateUser({ password })
    setSubmitting(false)
    if (updateError) {
      setError(updateError.message)
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div className="auth-content">
        <div className="auth-card">
          <h1 className="auth-title">Password updated</h1>
          <p className="auth-sub">You're all set.</p>
          <button className="btn-primary auth-submit" onClick={() => navigate('/')}>Go to app</button>
        </div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="auth-content">
        <div className="auth-card">
          <h1 className="auth-title">Reset your password</h1>
          <p className="auth-sub">Open this page from the link in your reset email.</p>
          <p className="auth-foot"><Link to="/forgot-password">Request a new link</Link></p>
        </div>
      </div>
    )
  }

  return (
    <div className="auth-content">
      <div className="auth-card">
        <h1 className="auth-title">Set a new password</h1>

        <form className="auth-form" onSubmit={submit}>
          <label className="auth-label">New password</label>
          <input
            className="auth-input" type="password" placeholder="At least 8 characters"
            value={password} onChange={e => setPassword(e.target.value)} required minLength={8}
          />
          {error && <div style={{ color: '#f87171', fontSize: '0.82rem', marginTop: '0.6rem' }}>{error}</div>}
          <button type="submit" className="btn-primary auth-submit" disabled={submitting}>
            {submitting ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    </div>
  )
}
