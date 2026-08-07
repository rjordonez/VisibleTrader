import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { SkelBlock } from './Skeleton'

/* ── Settings ── */
interface AppSettings {
  roster_size: number
  tiers: number[]
  ticker_min_usd: number
  scalp_window_minutes: number
}

const SETTINGS_DEFAULT: AppSettings = {
  roster_size: 500,
  tiers: [1000, 5000, 20000, 50000, 100000],
  ticker_min_usd: 100,
  scalp_window_minutes: 30,
}

interface Subscription {
  plan: string | null
  status: string | null
  current_period_end: string | null
}

const PLAN_LABEL: Record<string, string> = { pro: 'Pro', elite: 'Elite' }

function SettingsPage() {
  const navigate = useNavigate()
  const [settings, setSettings] = useState<AppSettings>(SETTINGS_DEFAULT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')

  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [subLoading, setSubLoading] = useState(true)
  const [portalLoading, setPortalLoading] = useState(false)
  const [portalError, setPortalError] = useState<string | null>(null)
  const [portalUrl, setPortalUrl] = useState<string | null>(null)

  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [cancelLoading, setCancelLoading] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  useEffect(() => {
    // Redirecting the whole page to Stripe's portal is an effect, not
    // inline in the click handler — same reasoning as PricingPage's
    // checkout redirect.
    if (portalUrl) window.location.href = portalUrl
  }, [portalUrl])

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
          setCancelError('Could not cancel the trial — please try again in a moment.')
          return
        }
        // ProtectedRoute only checks subscription status once per auth
        // change and caches it for the whole mounted /app tree, so it won't
        // notice this cancellation on its own — send them to /pricing so
        // re-mounting the route tree re-runs that check and locks them out.
        navigate('/pricing')
      })
  }

  useEffect(() => {
    Promise.resolve(
      supabase.from('app_settings').select('roster_size, tiers, ticker_min_usd, scalp_window_minutes').eq('id', 1).single()
    )
      .then(({ data, error }) => {
        if (error) throw error
        setSettings(data as AppSettings)
        setLoading(false)
      })
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }, [])

  const setTier = (i: number, value: number) => {
    setSettings(s => ({ ...s, tiers: s.tiers.map((t, idx) => (idx === i ? value : t)) }))
  }

  const save = () => {
    setSaveState('saving')
    // No server in the loop anymore to sanitize this before it hits the table
    // the Python service trusts — same clamping the old proxy did, now here.
    const tiers = [...new Set(settings.tiers.map(Number).filter(n => Number.isFinite(n) && n >= 0))].sort((a, b) => a - b)
    const cfg: AppSettings = {
      roster_size: Math.max(1, Math.min(2000, Math.round(Number(settings.roster_size)) || SETTINGS_DEFAULT.roster_size)),
      tiers: tiers.length > 0 ? tiers : SETTINGS_DEFAULT.tiers,
      ticker_min_usd: Math.max(1, Math.round(Number(settings.ticker_min_usd)) || SETTINGS_DEFAULT.ticker_min_usd),
      scalp_window_minutes: Math.max(1, Math.round(Number(settings.scalp_window_minutes)) || SETTINGS_DEFAULT.scalp_window_minutes),
    }
    Promise.resolve(
      supabase.from('app_settings').update(cfg).eq('id', 1)
        .select('roster_size, tiers, ticker_min_usd, scalp_window_minutes').single()
    )
      .then(({ data, error }) => {
        if (error) throw error
        setSettings(data as AppSettings)
        setSaveState('saved')
        setTimeout(() => setSaveState('idle'), 2500)
      })
      .catch(() => setSaveState('idle'))
  }

  return (
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Settings</h1>
          <p className="app-section-sub">
            {loading ? 'Loading…' : error ? 'Could not reach the signals backend' : 'Live pipeline configuration — changes apply within ~10s, no restart needed'}
          </p>
        </div>
      </div>

      <div className="sig-panel" style={{ maxWidth: 560 }}>
        <div style={{ marginBottom: 28, paddingBottom: 24, borderBottom: '1px solid var(--border)' }}>
          <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Subscription</div>
          {subLoading ? (
            <SkelBlock height={36} radius={6} />
          ) : subscription ? (
            <>
              <div style={{ fontSize: 14, marginBottom: 4 }}>
                <span style={{ fontWeight: 700 }}>{PLAN_LABEL[subscription.plan ?? ''] ?? subscription.plan ?? 'Unknown plan'}</span>
                {' — '}
                {subscription.status === 'trialing' && subscription.current_period_end
                  ? `trial ends ${new Date(subscription.current_period_end).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}`
                  : subscription.status}
              </div>
              <button className="sig-btn secondary" onClick={openPortal} disabled={portalLoading} style={{ marginTop: 8 }}>
                {portalLoading ? 'Opening…' : 'Manage subscription'}
              </button>
              {portalError && (
                <p style={{ color: '#f87171', fontSize: '0.8rem', marginTop: 8 }}>{portalError}</p>
              )}
              {subscription.status === 'trialing' && (
                confirmingCancel ? (
                  <div style={{ marginTop: 12, padding: 12, border: '1px solid var(--border)', borderRadius: 6 }}>
                    <p style={{ fontSize: '0.8rem', marginBottom: 8 }}>
                      Cancel your trial now? You'll lose access immediately — this can't be undone.
                    </p>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button className="sig-btn secondary" onClick={cancelTrial} disabled={cancelLoading} style={{ borderColor: '#f87171', color: '#f87171' }}>
                        {cancelLoading ? 'Canceling…' : 'Yes, cancel trial'}
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
                    Cancel trial
                  </button>
                )
              )}
            </>
          ) : (
            <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>No active subscription on file.</div>
          )}
        </div>

        {error && (
          <div style={{ color: '#ff3b5c', padding: '0 0 20px', fontSize: '0.875rem' }}>{error}</div>
        )}

        {loading && !error && (
          <>
            {[140, 100, 220, 260].map((w, i) => (
              <div key={i} style={{ marginBottom: 24 }}>
                <SkelBlock width={w} height={10} style={{ marginBottom: 8 }} />
                <SkelBlock height={36} radius={6} />
              </div>
            ))}
          </>
        )}

        {!loading && !error && (
          <>
            <div style={{ marginBottom: 24 }}>
              <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Roster size (top N traders by best_pnl)</div>
              <input
                className="sig-watch-input"
                type="number"
                min={1}
                max={2000}
                value={settings.roster_size}
                onChange={e => setSettings(s => ({ ...s, roster_size: Number(e.target.value) }))}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Conviction tiers ($)</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {settings.tiers.map((t, i) => (
                  <input
                    key={i}
                    className="sig-watch-input"
                    type="number"
                    min={0}
                    value={t}
                    onChange={e => setTier(i, Number(e.target.value))}
                    style={{ flex: '1 1 90px' }}
                  />
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Ticker minimum ($) — trades below this are ignored entirely</div>
              <input
                className="sig-watch-input"
                type="number"
                min={1}
                value={settings.ticker_min_usd}
                onChange={e => setSettings(s => ({ ...s, ticker_min_usd: Number(e.target.value) }))}
              />
            </div>

            <div style={{ marginBottom: 28 }}>
              <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Scalp window (minutes) — buy→sell faster than this counts as a scalp, not a genuine exit</div>
              <input
                className="sig-watch-input"
                type="number"
                min={1}
                value={settings.scalp_window_minutes}
                onChange={e => setSettings(s => ({ ...s, scalp_window_minutes: Number(e.target.value) }))}
              />
            </div>

            <button className="sig-btn" onClick={save} disabled={saveState === 'saving'}>
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : 'Save settings'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default SettingsPage
