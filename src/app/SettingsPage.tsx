import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import posthog from '../lib/posthog'
import { SkelBlock } from './Skeleton'
import { Link, useSearchParams } from 'react-router-dom'
import { dashboardPath } from '../lib/domains'

interface Subscription {
  plan: string | null
  status: string | null
  current_period_end: string | null
}

const PLAN_LABEL: Record<string, string> = { pro: 'Pro', elite: 'Elite' }

function SettingsPage() {
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [subLoading, setSubLoading] = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)
  const [portalUrl, setPortalUrl] = useState<string | null>(null)

  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  const [leaveUrl, setLeaveUrl] = useState<string | null>(null)

  // ?refund=1 comes from the charge receipt email's "Request a refund" link.
  const [searchParams] = useSearchParams()
  const [refundOpen, setRefundOpen] = useState(searchParams.get('refund') === '1')
  const [refundReason, setRefundReason] = useState('')
  const [refundLoading, setRefundLoading] = useState(false)
  const [refundError, setRefundError] = useState<string | null>(null)
  const [refundSent, setRefundSent] = useState(false)

  useEffect(() => {
    // Redirecting the whole page to Stripe's portal is an effect, not
    // inline in the click handler — same reasoning as PricingPage's
    // checkout redirect.
    if (portalUrl) window.location.href = portalUrl
  }, [portalUrl])

  useEffect(() => {
    if (leaveUrl) window.location.href = leaveUrl
  }, [leaveUrl])

  useEffect(() => {
    Promise.resolve(
      supabase.from('subscriptions').select('plan, status, current_period_end').maybeSingle()
    )
      .then(({ data }) => setSubscription(data as Subscription | null))
      .catch(() => setSubscription(null))
      .finally(() => setSubLoading(false))
  }, [])

  const openPortal = () => {
    setPortalLoading(true)
    setPortalError(null)
    supabase.functions.invoke('create-portal-session', { body: {} })
      .then(({ data, error }) => {
        if (error || !data?.url) {
          setPortalLoading(false)
          setPortalError('Could not open the billing portal — please try again in a moment.')
          return
        }
        posthog.capture('subscription_portal_requested')
        setPortalUrl(data.url)
      })
  }

  const cancelTrial = () => {
    setCancelLoading(true)
    setCancelError(null)
    supabase.functions.invoke('cancel-trial', { body: {} })
      .then(({ data, error }) => {
        setCancelLoading(false)
        if (error || !data?.canceled) {
          setCancelError('Could not cancel the introductory period — please try again in a moment.')
          return
        }
        // ProtectedRoute only checks subscription status once per auth
        // change and caches it for the whole mounted app tree, so it won't
        // notice this cancellation on its own — force a fresh mount so it
        // re-runs that check and shows the in-app paywall.
        posthog.capture('trial_canceled')
        setLeaveUrl('/')
      })
  }

  const requestRefund = () => {
    setRefundLoading(true)
    setRefundError(null)
    supabase.functions.invoke('request-refund', { body: { reason: refundReason } })
      .then(({ data, error }) => {
        setRefundLoading(false)
        if (error || !data?.requested) {
          setRefundError('Could not send your request. Please try again in a moment.')
          return
        }
        posthog.capture('refund_requested')
        setRefundSent(true)
      })
  }

  // Refunds only apply once a full-price charge exists, i.e. after the trial.
  const canRequestRefund = !!subscription && subscription.status !== 'trialing'

  return (
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Settings</h1>
          <p className="app-section-sub">
            Manage your subscription and connected accounts.
          </p>
        </div>
      </div>

      <div className="sig-panel settings-panel">
        <div className="settings-subscription">
          <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Connected accounts</div>
          <p style={{ color: 'var(--text-dim)', fontSize: 13, marginBottom: 12 }}>Connect your trading accounts to Journal and manage access.</p>
          <Link className="sig-btn secondary" to={dashboardPath('/settings/connections')}>Manage connections</Link>
        </div>
        <div className="settings-subscription">
          <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Subscription</div>
          {subLoading ? (
            <SkelBlock height={36} radius={6} />
          ) : subscription ? (
            <>
              <div style={{ fontSize: 14, marginBottom: 4 }}>
                <span style={{ fontWeight: 700 }}>{PLAN_LABEL[subscription.plan ?? ''] ?? subscription.plan ?? 'Unknown plan'}</span>
                {' — '}
                {subscription.status === 'trialing' && subscription.current_period_end
                  ? `introductory period ends ${new Date(subscription.current_period_end).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`
                  : subscription.status}
              </div>
              <button className="sig-btn secondary" onClick={openPortal} disabled={portalLoading} style={{ marginTop: 8 }}>
                {portalLoading ? 'Opening…' : 'Manage subscription'}
              </button>
              {canRequestRefund && !refundOpen && !refundSent && (
                <button className="sig-btn secondary" onClick={() => setRefundOpen(true)} style={{ marginTop: 8, marginLeft: 8 }}>
                  Request a refund
                </button>
              )}
              {portalError && (
                <p style={{ color: '#f87171', fontSize: '0.8rem', marginTop: 8 }}>{portalError}</p>
              )}
              {canRequestRefund && refundSent && (
                <div className="settings-cancel-confirm">
                  <p style={{ fontSize: '0.85rem', margin: 0 }}>
                    We've received your refund request. Our team will email you within 24 to 72 hours.
                  </p>
                </div>
              )}
              {canRequestRefund && refundOpen && !refundSent && (
                <div className="settings-cancel-confirm">
                  <p style={{ fontSize: '0.8rem', marginBottom: 8 }}>
                    Tell us what happened and our team will get back to you by email within 24 to 72 hours.
                  </p>
                  <textarea
                    value={refundReason}
                    onChange={(e) => setRefundReason(e.target.value)}
                    maxLength={2000}
                    rows={3}
                    placeholder="What went wrong? (optional)"
                    style={{ width: '100%', boxSizing: 'border-box', marginBottom: 8, padding: 8, borderRadius: 6, font: 'inherit', fontSize: '0.85rem', background: 'transparent', color: 'inherit', border: '1px solid var(--border, #2a2f3a)' }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="sig-btn secondary" onClick={requestRefund} disabled={refundLoading}>
                      {refundLoading ? 'Sending…' : 'Send refund request'}
                    </button>
                    <button className="sig-btn secondary" onClick={() => setRefundOpen(false)} disabled={refundLoading}>
                      Never mind
                    </button>
                  </div>
                  {refundError && (
                    <p style={{ color: '#f87171', fontSize: '0.8rem', marginTop: 8 }}>{refundError}</p>
                  )}
                </div>
              )}
              {subscription.status === 'trialing' && (
                confirmingCancel ? (
                  <div className="settings-cancel-confirm">
                    <p style={{ fontSize: '0.8rem', marginBottom: 8 }}>
                      Cancel your introductory period now? You'll lose access immediately and won't be billed for renewal — this can't be undone.
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="sig-btn secondary" onClick={cancelTrial} disabled={cancelLoading} style={{ borderColor: '#f87171', color: '#f87171' }}>
                        {cancelLoading ? 'Canceling…' : 'Yes, cancel subscription'}
                      </button>
                      <button className="sig-btn secondary" onClick={() => setConfirmingCancel(false)} disabled={cancelLoading}>
                        Never mind
                      </button>
                    </div>
                    {cancelError && (
                      <p style={{ color: '#f87171', fontSize: '0.8rem', marginTop: 8 }}>{cancelError}</p>
                    )}
                  </div>
                ) : (
                  <button className="sig-btn secondary" onClick={() => setConfirmingCancel(true)} style={{ marginTop: 8, marginLeft: 8, borderColor: '#f87171', color: '#f87171' }}>
                    Cancel introductory period
                  </button>
                )
              )}
            </>
          ) : (
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>No active subscription on file.</div>
          )}
        </div>


      </div>
    </div>
  )
}

export default SettingsPage
