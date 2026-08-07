import './landing.css'
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSubmitting(true)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    setSubmitting(false)
    if (signInError) {
      setError(signInError.message)
      return
    }
    navigate('/app')
  }

  return (
    <div className="auth-content">
      <div className="auth-card">
        <h1 className="auth-title">Log in</h1>
        <p className="auth-sub">Welcome back.</p>

        <form className="auth-form" onSubmit={submit}>
          <label className="auth-label">Email</label>
          <input
            className="auth-input" type="email" placeholder="you@example.com"
            value={email} onChange={e => setEmail(e.target.value)} required
          />
          <label className="auth-label">Password</label>
          <input
            className="auth-input" type="password" placeholder="Your password"
            value={password} onChange={e => setPassword(e.target.value)} required
          />
          <Link to="/forgot-password" className="auth-forgot">Forgot password?</Link>
          {error && <div style={{ color: '#f87171', fontSize: '0.82rem', marginTop: '0.6rem' }}>{error}</div>}
          <button type="submit" className="btn-primary auth-submit" disabled={submitting}>
            {submitting ? 'Logging in…' : 'Log in'}
          </button>
        </form>

        <p className="auth-foot">
          Don't have an account? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </div>
  )
}
