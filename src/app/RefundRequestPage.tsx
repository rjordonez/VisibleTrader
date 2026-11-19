import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import posthog from '../lib/posthog'
import { SkelBlock } from './Skeleton'
import { dashboardPath } from '../lib/domains'

// Dedicated refund request page (from Settings and the charge receipt email).
// Nothing is refunded automatically: the request is recorded, emailed to the
// support team, and the customer gets a reference and a confirmation email.

type Preview =
  | { eligible: true; email: string; amount_cents: number; currency: string; paid_at: number; existing_reference: string | null }
  | { eligible: false; why: 'trial' | 'no_charge' | 'no_subscription' }

const REASONS: { key: string; label: string }[] = [
  { key: 'forgot_to_cancel', label: 'I meant to cancel before I was charged' },
  { key: 'not_expected', label: "The product wasn't what I expected" },
  { key: 'technical', label: 'Something did not work' },
  { key: 'unexpected_charge', label: "I didn't expect this charge" },
  { key: 'other', label: 'Other' },
]
const MIN_DETAILS = 20

const formatAmount = (cents: number, currency: string) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
const formatDate = (unix: number) =>
  new Date(unix * 1000).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })

const label: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 8 }
const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: 10, borderRadius: 8, font: 'inherit', fontSize: '0.9rem', background: 'transparent', color: 'inherit', border: '1px solid var(--border, #2a2f3a)' }

export default function RefundRequestPage() {
  const [preview, setPreview] = useState<Preview | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [category, setCategory] = useState('')
  const [details, setDetails] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [reference, setReference] = useState<string | null>(null)

  useEffect(() => {
    supabase.functions.invoke('request-refund', { body: { mode: 'preview' } })
      .then(({ data, error }) => {
        if (error || !data) {
          setLoadError('We could not load your billing details. Please try again in a moment.')
          return
        }
        setPreview(data as Preview)
      })
  }, [])

  const detailsOk = details.trim().length >= MIN_DETAILS
  const canSubmit = !!category && detailsOk && confirm && !submitting

  const submit = () => {
    setSubmitting(true)
    setSubmitError(null)
    supabase.functions.invoke('request-refund', { body: { category, details: details.trim(), confirm: true } })
      .then(({ data, error }) => {
        setSubmitting(false)
        if (error || !data?.reference) {
          setSubmitError('We could not submit your request. Please try again in a moment.')
          return
        }
        posthog.capture('refund_requested', { category })
        setReference(data.reference)
      })
  }

  const header = (
    <div className="app-section-header">
      <div>
        <h1 className="app-section-title">Request a refund</h1>
        <p className="app-section-sub">Our team reviews every request personally and replies by email within 24 to 72 hours.</p>
      </div>
    </div>
  )
  const back = <Link className="sig-btn secondary" to={dashboardPath('/settings')}>Back to settings</Link>

  if (loadError) {
    return <div className="sig-page">{header}<div className="sig-panel settings-panel"><div className="settings-subscription"><p style={{ marginTop: 0 }}>{loadError}</p>{back}</div></div></div>
  }
  if (!preview) {
    return <div className="sig-page">{header}<div className="sig-panel settings-panel"><SkelBlock height={220} radius={10} /></div></div>
  }
  if (!preview.eligible) {
    const message = preview.why === 'trial'
      ? "You're still in your $1 introductory week, so there's no full charge to refund yet. You can cancel your introductory period in Settings and you won't be charged."
      : preview.why === 'no_charge'
        ? "We couldn't find a full-price charge on your account to refund. If you think this is wrong, reply to any of our emails and we'll take a look."
        : "We couldn't find a subscription on your account."
    return <div className="sig-page">{header}<div className="sig-panel settings-panel"><div className="settings-subscription"><p style={{ marginTop: 0, lineHeight: 1.5 }}>{message}</p>{back}</div></div></div>
  }

  const shownReference = reference ?? preview.existing_reference
  if (shownReference) {
    return (
      <div className="sig-page">
        {header}
        <div className="sig-panel settings-panel">
          <div className="settings-subscription">
            <div style={label}>Request received</div>
            <h2 style={{ margin: '0 0 12px', fontSize: 20 }}>We've got your refund request</h2>
            <p style={{ margin: '0 0 16px', lineHeight: 1.5 }}>
              We'll review it and email you at <strong>{preview.email}</strong> within 24 to 72 hours.
              A confirmation has been sent to your inbox.
            </p>
            <table style={{ borderCollapse: 'collapse', fontSize: 14, marginBottom: 20 }}>
              <tbody>
                <tr><td style={{ padding: '4px 16px 4px 0', color: 'var(--text-dim)' }}>Reference</td><td><strong>{shownReference}</strong></td></tr>
                <tr><td style={{ padding: '4px 16px 4px 0', color: 'var(--text-dim)' }}>Amount</td><td>{formatAmount(preview.amount_cents, preview.currency)}</td></tr>
                <tr><td style={{ padding: '4px 16px 4px 0', color: 'var(--text-dim)' }}>Charge date</td><td>{formatDate(preview.paid_at)}</td></tr>
              </tbody>
            </table>
            <p style={{ margin: '0 0 20px', fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5 }}>
              If approved, the refund goes back to your original payment method and usually appears within 5 to 10 business days.
            </p>
            {back}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="sig-page">
      {header}
      <div className="sig-panel settings-panel">
        <div className="settings-subscription">
          <div style={label}>Charge</div>
          <table style={{ borderCollapse: 'collapse', fontSize: 14 }}>
            <tbody>
              <tr><td style={{ padding: '4px 16px 4px 0', color: 'var(--text-dim)' }}>Description</td><td>Visible Trader Pro subscription</td></tr>
              <tr><td style={{ padding: '4px 16px 4px 0', color: 'var(--text-dim)' }}>Amount</td><td><strong>{formatAmount(preview.amount_cents, preview.currency)}</strong></td></tr>
              <tr><td style={{ padding: '4px 16px 4px 0', color: 'var(--text-dim)' }}>Charge date</td><td>{formatDate(preview.paid_at)}</td></tr>
              <tr><td style={{ padding: '4px 16px 4px 0', color: 'var(--text-dim)' }}>Account</td><td>{preview.email}</td></tr>
            </tbody>
          </table>
        </div>

        <div className="settings-subscription">
          <div style={label}>Why are you requesting a refund?</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {REASONS.map((r) => (
              <label key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: '0.9rem' }}>
                <input type="radio" name="refund-reason" value={r.key} checked={category === r.key} onChange={() => setCategory(r.key)} />
                {r.label}
              </label>
            ))}
          </div>

          <div style={label}>Tell us what happened</div>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={2000}
            rows={5}
            placeholder="A few details help us review your request faster."
            style={{ ...field, marginBottom: 6 }}
          />
          <div style={{ fontSize: 12, color: detailsOk ? 'var(--text-dim)' : '#f87171', marginBottom: 20 }}>
            {detailsOk ? `${details.trim().length} / 2000` : `At least ${MIN_DETAILS} characters (${details.trim().length} so far)`}
          </div>

          <div style={{ fontSize: 13, color: 'var(--text-dim)', lineHeight: 1.5, marginBottom: 16 }}>
            If your refund is approved, the full amount goes back to your original payment method (usually within 5 to 10 business days) and your subscription is canceled.
          </div>

          <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: '0.85rem', marginBottom: 20 }}>
            <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} style={{ marginTop: 3 }} />
            I confirm the information above is accurate and understand this request will be reviewed by the Visible Trader team.
          </label>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="sig-btn" onClick={submit} disabled={!canSubmit}>
              {submitting ? 'Submitting…' : 'Submit refund request'}
            </button>
            {back}
          </div>
          {submitError && <p style={{ color: '#f87171', fontSize: '0.85rem', marginTop: 12 }}>{submitError}</p>}
        </div>
      </div>
    </div>
  )
}
