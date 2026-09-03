import { useState } from 'react'
import { Bell } from 'lucide-react'
import { traderLabel, fmtFull, timeAgo } from './helpers'
import type { AlertEvent, WalletWatch } from './useAlerts'

/* ── Alerts ──
   State/polling now lives in useAlerts.ts (owned by AppShell, see
   index.tsx) instead of here, so it keeps running and accumulating
   history regardless of which tab is active — this page (and the header
   bell's dropdown) are both just views onto that same shared state. */
function AlertsPage({ watchedWallets, minTier, setMinTier, permission, requestPermission, history, addWallet, removeWallet }: {
  watchedWallets: WalletWatch[]
  minTier: number
  setMinTier: (tier: number) => void
  permission: NotificationPermission
  requestPermission: () => void
  history: AlertEvent[]
  addWallet: (wallet: string) => void
  removeWallet: (wallet: string) => void
}) {
  const [walletInput, setWalletInput] = useState('')

  const submitWallet = () => {
    addWallet(walletInput)
    setWalletInput('')
  }

  return (
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Alerts</h1>
          <p className="app-section-sub">Fires while this tab is open — not a background/closed-tab push notification</p>
        </div>
      </div>

      <div className="sig-panel">
        {permission !== 'granted' && (
          <div style={{ marginBottom: 24 }}>
            <button className="sig-btn" onClick={requestPermission}>Enable browser notifications</button>
          </div>
        )}

        <div style={{ marginBottom: 28 }}>
          <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Watch a wallet</div>
          <div className="sig-watch-form">
            <input
              className="sig-watch-input"
              placeholder="0x… wallet address"
              value={walletInput}
              onChange={e => setWalletInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitWallet()}
            />
            <button className="sig-btn" onClick={submitWallet}>Add</button>
          </div>
          {watchedWallets.map(w => (
            <div key={w.wallet} className="sig-watch-item">
              <span>{traderLabel(w.wallet, null)}</span>
              <span className="sig-watch-remove" onClick={() => removeWallet(w.wallet)}>Remove</span>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 28 }}>
          <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Alert on any signal crossing</div>
          <div className="sig-chips">
            {[1000, 5000, 20000, 50000, 100000].map(t => (
              <div key={t} className={minTier === t ? 'sig-chip active' : 'sig-chip'} onClick={() => setMinTier(t)}>
                {fmtFull(t)}+
              </div>
            ))}
          </div>
        </div>

        <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Alert history</div>
        {history.length === 0 ? (
          <div className="sig-empty">No alerts yet.</div>
        ) : (
          <div className="lb-table">
            {history.map(h => (
              <div className="lb-row lb-1col" key={h.id}>
                <div className="lb-trader">
                  <div className="lb-avatar" style={{ background: 'var(--surface-2)', color: 'var(--blue)' }}>
                    <Bell size={16} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div className="sig-q">{h.text}</div>
                  </div>
                </div>
                <div className="lb-stats">
                  <div className="lb-col">
                    <div className="lb-val-sub" style={{ color: 'var(--text-faint)' }}>{timeAgo(new Date(h.ts).toISOString())}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default AlertsPage
