import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { oauthRedirectUrl } from '../../lib/domains'

// Shared by LoginPage and SignupPage — same providers, same full-page
// redirect flow either way (Supabase treats OAuth sign-in and sign-up as
// the same call; there's no separate "register" variant). Error display
// is left to the caller so it lands in the same spot as the password
// form's own error message instead of a second, differently-styled one.
export default function OAuthButtons({ onError }: { onError: (message: string) => void }) {
  const [provider, setProvider] = useState<'google' | 'apple' | null>(null)

  const signIn = async (p: 'google' | 'apple') => {
    onError('')
    setProvider(p)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: p, options: { redirectTo: oauthRedirectUrl() },
    })
    if (error) {
      onError(error.message)
      setProvider(null)
    }
  }

  return (
    <>
      <div className="auth-oauth-row">
        <button
          type="button" className="auth-oauth-btn" onClick={() => signIn('google')}
          disabled={provider !== null}
        >
          <svg width="18" height="18" viewBox="0 0 18 18">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.87 2.7-6.62Z"/>
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z"/>
            <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33Z"/>
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z"/>
          </svg>
          {provider === 'google' ? 'Redirecting…' : 'Continue with Google'}
        </button>
        <button
          type="button" className="auth-oauth-btn" onClick={() => signIn('apple')}
          disabled={provider !== null}
        >
          <svg width="16" height="18" viewBox="0 0 16 18" fill="currentColor">
            <path d="M13.15 9.55c-.02-2.03 1.66-3 1.74-3.06-.95-1.39-2.42-1.58-2.95-1.6-1.26-.13-2.45.74-3.09.74-.64 0-1.62-.72-2.66-.7-1.37.02-2.63.8-3.34 2.02-1.42 2.47-.36 6.14 1.02 8.14.68.98 1.48 2.08 2.54 2.04 1.02-.04 1.4-.66 2.63-.66 1.23 0 1.58.66 2.66.64 1.1-.02 1.79-.99 2.46-1.98.77-1.13 1.09-2.23 1.1-2.28-.02-.01-2.1-.81-2.12-3.2Z"/>
            <path d="M11.16 3.5c.56-.68.94-1.62.83-2.56-.81.03-1.79.54-2.37 1.21-.52.6-.97 1.56-.85 2.48.9.07 1.82-.46 2.39-1.13Z"/>
          </svg>
          {provider === 'apple' ? 'Redirecting…' : 'Continue with Apple'}
        </button>
      </div>
      <div className="auth-divider"><span>or</span></div>
    </>
  )
}
