import './landing.css'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import OAuthButtons from './components/OAuthButtons'

export default function LoginPage() {
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="auth-content">
      <div className="auth-card">
        <h1 className="auth-title">Log in</h1>
        <p className="auth-sub">Welcome back.</p>

        <OAuthButtons onError={setError} />

        {error && <div style={{ color: '#f87171', fontSize: '0.82rem', marginTop: '0.6rem' }}>{error}</div>}

        <p className="auth-foot">
          Don't have an account? <Link to="/signup">Sign up</Link>
        </p>
      </div>
    </div>
  )
}
