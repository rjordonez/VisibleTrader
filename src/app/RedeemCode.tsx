import { useState } from 'react'
import { supabase } from '../lib/supabase'

// Small "have a code?" link/form — lets someone with a comp code (see
// supabase/migrations/20260925120000_access_codes.sql) unlock the app
// themselves without going through Stripe or needing their email known
// ahead of time. On success, reloads so ProtectedRoute re-fetches the
// subscriptions row it already owns rather than this component trying to
// reach across to that state.
//
// Mounted on both the in-app paywall overlay (app/index.tsx) and the
// marketing pricing page (landing/PricingPage.tsx) — those live in separate
// CSS bundles, so `ctaClassName` lets each caller pass its own submit-button
// style (matching each page's existing CTA look) while the rest of the
// markup stays shared.
export default function RedeemCode({ ctaClassName = '' }: { ctaClassName?: string }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState('')
  const [status, setStatus] = useState<'idle' | 'checking' | 'invalid'>('idle')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!code.trim() || status === 'checking') return
    setStatus('checking')
    const { data, error } = await supabase.rpc('redeem_access_code', { code_input: code.trim() })
    if (error || !data) {
      setStatus('invalid')
      return
    }
    window.location.reload()
  }

  if (!open) {
    return (
      <button type="button" className="redeem-code-link" onClick={() => setOpen(true)}>
        Have an access code?
      </button>
    )
  }

  return (
    <form className="redeem-code-form" onSubmit={submit}>
      <input
        type="text"
        value={code}
        onChange={e => { setCode(e.target.value); setStatus('idle') }}
        placeholder="Access code"
        autoFocus
        className="redeem-code-input"
      />
      <button type="submit" className={ctaClassName || 'redeem-code-btn'} disabled={status === 'checking'}>
        {status === 'checking' ? 'Checking…' : 'Redeem'}
      </button>
      {status === 'invalid' && <p className="redeem-code-error">That code isn&rsquo;t valid.</p>}
    </form>
  )
}
