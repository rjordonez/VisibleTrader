import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import type { Opportunity, TickerTrade } from './types'
import { onTabVisible, PAGE_SIZE, traderLabel, fmtFull, timeAgo, WATCHED_WALLETS_KEY } from './helpers'

/* ── Alerts ── */
interface WalletWatch { wallet: string }
interface AlertEvent { id: string; text: string; ts: number }

const WATCHED_TIER_KEY = 'visibletrader_watched_tier'

function AlertsPage() {
  const [watchedWallets, setWatchedWallets] = useState<WalletWatch[]>(() => {
    try {
      const raw = localStorage.getItem(WATCHED_WALLETS_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })
  const [minTier, setMinTier] = useState<number>(() => {
    const raw = localStorage.getItem(WATCHED_TIER_KEY)
    return raw ? Number(raw) : 5000
  })
  const [walletInput, setWalletInput] = useState('')
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied'
  )
  const [history, setHistory] = useState<AlertEvent[]>([])
  const seenTicker = useRef<Set<number>>(new Set())
  const seenTier = useRef<Set<string>>(new Set())

  useEffect(() => { localStorage.setItem(WATCHED_WALLETS_KEY, JSON.stringify(watchedWallets)) }, [watchedWallets])
  useEffect(() => { localStorage.setItem(WATCHED_TIER_KEY, String(minTier)) }, [minTier])

  const fire = useCallback((text: string) => {
    setHistory(h => [{ id: `${Date.now()}-${Math.random()}`, text, ts: Date.now() }, ...h].slice(0, 50))
    if (permission === 'granted' && 'Notification' in window) {
      new Notification('VisibleTrader Signals', { body: text })
    }
  }, [permission])

  useEffect(() => {
    if (watchedWallets.length === 0) return
    let cancelled = false
    const load = () => {
      Promise.resolve(supabase.from('ticker').select('*').order('epoch', { ascending: false }).limit(200))
        .then(({ data }) => {
          if (cancelled) return
          for (const t of (data ?? []) as TickerTrade[]) {
            if (!t.wallet || seenTicker.current.has(t.id)) continue
            const watched = watchedWallets.find(w => w.wallet.toLowerCase() === t.wallet!.toLowerCase())
            if (!watched) continue
            seenTicker.current.add(t.id)
            fire(`${traderLabel(t.wallet, t.wallet_name)} ${t.side === 'BUY' ? 'bought' : 'sold'} ${fmtFull(t.usd)} — ${t.title}`)
          }
        })
        .catch(() => {})
    }
    load()
    // No realtime channel backs this one — it's a plain poll, deduped
    // client-side via seenTicker. 5s was needlessly aggressive for a
    // desktop-notification feature; 15s (matching LeaderboardPage/
    // ProfitsPage's existing cadence) still notifies promptly.
    const interval = setInterval(load, 15000)
    const unsubVisible = onTabVisible(load)
    return () => { cancelled = true; clearInterval(interval); unsubVisible() }
  }, [watchedWallets, permission, fire])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      Promise.resolve(supabase.from('opportunities_live').select('*')
        .order('last_updated', { ascending: false }).order('id', { ascending: false })
        .limit(PAGE_SIZE))
        .then(({ data }) => {
          if (cancelled) return
          for (const o of (data ?? []) as Opportunity[]) {
            if (o.tier < minTier) continue
            const key = `${o.condition_id}::${o.outcome}::${o.tier}`
            if (seenTier.current.has(key)) continue
            seenTier.current.add(key)
            fire(`Tier crossed: ${o.title} — ${o.outcome} hit ${fmtFull(o.tier)}+ (${o.wallet_count} wallets)`)
          }
        })
        .catch(() => {})
    }
    load()
    // Same reasoning as the ticker-alert effect above — no realtime
    // backing this poll, so 5s was pure unnecessary egress; 15s is plenty
    // for a notification feature.
    const interval = setInterval(load, 15000)
    const unsubVisible = onTabVisible(load)
    return () => { cancelled = true; clearInterval(interval); unsubVisible() }
  }, [minTier, permission, fire])

  const requestPermission = () => {
    if (!('Notification' in window)) return
    Notification.requestPermission().then(p => setPermission(p))
  }

  const addWallet = () => {
    const addr = walletInput.trim()
    if (!addr) return
    setWatchedWallets(w => (w.some(x => x.wallet.toLowerCase() === addr.toLowerCase()) ? w : [...w, { wallet: addr }]))
    setWalletInput('')
  }

  const removeWallet = (wallet: string) => setWatchedWallets(w => w.filter(x => x.wallet !== wallet))

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
              onKeyDown={e => e.key === 'Enter' && addWallet()}
            />
            <button className="sig-btn" onClick={addWallet}>Add</button>
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
          <div className="sig-table-wrap">
            <table className="sig-table">
              <tbody>
                {history.map(h => (
                  <tr key={h.id}>
                    <td>{h.text}</td>
                    <td className="num" style={{ color: 'var(--text-dim)', width: 90 }}>{timeAgo(new Date(h.ts).toISOString())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default AlertsPage
