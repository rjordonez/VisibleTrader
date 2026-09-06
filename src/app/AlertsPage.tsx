import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Bell, Plus, Users, X, Zap } from 'lucide-react'
import { dashboardPath } from '../lib/domains'
import { traderLabel, fmtFull, timeAgo } from './helpers'
import type { useAlerts } from './useAlerts'

// Home and the header bell consume the same AppShell-owned alert state.
// This view never starts another polling loop or requests notification permission automatically.
function AlertsPage({ watchedWallets, minTier, setMinTier, permission, requestPermission, history, addWallet, removeWallet }: ReturnType<typeof useAlerts>) {
  const [walletInput, setWalletInput] = useState('')
  const [walletError, setWalletError] = useState('')
  const notificationsSupported = typeof window !== 'undefined' && 'Notification' in window

  const submitWallet = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const address = walletInput.trim()
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      setWalletError('Enter a valid wallet address: 0x followed by 40 letters and numbers.')
      return
    }
    if (watchedWallets.some(w => w.wallet.toLowerCase() === address.toLowerCase())) {
      setWalletError('You’re already following this wallet.')
      return
    }
    addWallet(address)
    setWalletInput('')
    setWalletError('')
  }

  return (
    <div className="home-alert-controls">
        <section className="home-control-section">
          <h3><Users size={16} /> Follow a wallet</h3>
          <p>See a wallet’s buys and sells in your feed.</p>
          <form onSubmit={submitWallet} className="home-wallet-form">
            <label htmlFor="home-wallet-address">Wallet address</label>
            <div><input id="home-wallet-address" placeholder="0x…" value={walletInput} onChange={e => { setWalletInput(e.target.value); setWalletError('') }} autoComplete="off" spellCheck={false} aria-invalid={!!walletError} aria-describedby={walletError ? 'home-wallet-error' : undefined} /><button type="submit" aria-label="Follow wallet"><Plus size={20} /></button></div>
            {walletError && <p id="home-wallet-error" className="home-wallet-error" role="alert">{walletError}</p>}
          </form>
          {watchedWallets.length > 0 && <ul className="home-manage-wallets">{watchedWallets.map(w => <li key={w.wallet}><Link to={dashboardPath(`/trader/${w.wallet}`)} title={w.wallet}>{traderLabel(w.wallet, null)}</Link><button type="button" onClick={() => removeWallet(w.wallet)} aria-label={`Unfollow ${w.wallet}`}><X size={15} /></button></li>)}</ul>}
        </section>
        <section className="home-control-section">
          <h3><Zap size={16} /> Signal threshold</h3>
          <p>Also show market signals crossing this amount.</p>
          <div className="home-thresholds">{[1000, 5000, 20000, 50000, 100000].map(t => <button key={t} type="button" aria-pressed={minTier === t} className={minTier === t ? 'active' : undefined} onClick={() => setMinTier(t)}>{fmtFull(t)}+</button>)}</div>
        </section>
        <section className="home-control-section">
          <h3><Bell size={16} /> Browser notifications</h3>
          {permission === 'granted' ? <p className="home-notifications-on">Enabled for this browser.</p> : notificationsSupported && permission === 'default' ? <><p>Get notified while VisibleTrader is open.</p><button type="button" className="home-notification-button" onClick={requestPermission}>Enable notifications</button></> : <p>{notificationsSupported ? 'Notifications are blocked. You can enable them in your browser’s site settings.' : 'This browser does not support notifications.'} Your alerts will still appear in the feed.</p>}
        </section>
      <section className="home-control-section home-alert-history">
        <h3><Bell size={16} /> Alert history</h3>
        <p>Signal thresholds affect these alerts. The Following trade feed shows all available trades from your wallets.</p>
        {history.length === 0 ? <p>No alerts this session yet.</p> : <ol>{history.map(h => <li key={h.id}><p>{h.text}</p><time dateTime={new Date(h.ts).toISOString()}>{timeAgo(new Date(h.ts).toISOString())}</time></li>)}</ol>}
        <p>Alerts are checked every minute while the app is open. History lasts for this session.</p>
      </section>
    </div>
  )
}

export default AlertsPage
