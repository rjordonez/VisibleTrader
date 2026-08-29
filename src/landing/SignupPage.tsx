import './landing.css'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import OAuthButtons from './components/OAuthButtons'

export default function SignupPage() {
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="auth-content">
      <div className="auth-card">
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-sub">Start free, upgrade whenever you're ready.</p>

        <OAuthButtons onError={setError} />

        {error && <div style={{ color: '#f87171', fontSize: '0.82rem', marginTop: '0.6rem' }}>{error}</div>}

        <p className="auth-foot">
          Already have an account? <Link to="/login">Log in</Link>
        </p>
      </div>
    </div>
  )
}
