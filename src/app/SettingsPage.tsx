import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

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

function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(SETTINGS_DEFAULT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')

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
        {error && (
          <div style={{ color: '#ff3b5c', padding: '0 0 20px', fontSize: '0.875rem' }}>{error}</div>
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
              <div style={{ display: 'flex', gap: 8 }}>
                {settings.tiers.map((t, i) => (
                  <input
                    key={i}
                    className="sig-watch-input"
                    type="number"
                    min={0}
                    value={t}
                    onChange={e => setTier(i, Number(e.target.value))}
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
