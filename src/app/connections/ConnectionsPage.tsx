import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowUpRight, Check, Globe2, Link2, RefreshCw, ShieldCheck, Unplug, Wallet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import ConnectDialog from './ConnectDialog'
import { connectionRequest, loadConnection, loadUSConnection, money, shortAddress } from './api'
import type { Connection, Snapshot, USConnection, USSnapshot } from './api'
import './connections.css'

export default function ConnectionsPage() {
  const [connection, setConnection] = useState<Connection | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [venue, setVenue] = useState<'international' | 'us' | null>(null)
  const [tab, setTab] = useState<'positions' | 'activity'>('positions')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const request = useRef<AbortController | null>(null)
  const generation = useRef(0)
  const alive = useRef(true)
  const lastUserId = useRef<string | null | undefined>(undefined)

  const [usConnection, setUsConnection] = useState<USConnection | null>(null)
  const [usSnapshot, setUsSnapshot] = useState<USSnapshot | null>(null)
  const [usRefreshing, setUsRefreshing] = useState(false)
  const [usSyncError, setUsSyncError] = useState('')
  const [usTab, setUsTab] = useState<'positions' | 'activity'>('positions')
  const [usConfirmDisconnect, setUsConfirmDisconnect] = useState(false)
  const [usDisconnecting, setUsDisconnecting] = useState(false)
  const usRequest = useRef<AbortController | null>(null)
  const usGeneration = useRef(0)

  const refresh = useCallback(async () => {
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    const run = generation.current
    setRefreshing(true)
    setSyncError('')
    try {
      const data = await connectionRequest<Snapshot>({ action: 'snapshot' }, controller.signal)
      if (controller.signal.aborted || run !== generation.current || !alive.current) return
      setSnapshot(data)
      setConnection(data.connection)
    } catch (e) {
      if (!controller.signal.aborted && run === generation.current && alive.current) setSyncError(e instanceof Error ? e.message : 'Could not refresh your portfolio.')
    } finally { if (!controller.signal.aborted && run === generation.current && alive.current) setRefreshing(false) }
  }, [])

  const usRefresh = useCallback(async () => {
    usRequest.current?.abort()
    const controller = new AbortController()
    usRequest.current = controller
    const run = usGeneration.current
    setUsRefreshing(true)
    setUsSyncError('')
    try {
      const data = await connectionRequest<USSnapshot>({ action: 'snapshot' }, controller.signal, 'polymarket-us-connect')
      if (controller.signal.aborted || run !== usGeneration.current || !alive.current) return
      setUsSnapshot(data)
      setUsConnection(data.connection)
    } catch (e) {
      if (!controller.signal.aborted && run === usGeneration.current && alive.current) setUsSyncError(e instanceof Error ? e.message : 'Could not refresh your portfolio.')
    } finally { if (!controller.signal.aborted && run === usGeneration.current && alive.current) setUsRefreshing(false) }
  }, [])

  const initialize = useCallback(async () => {
    const run = ++generation.current
    const usRun = ++usGeneration.current
    request.current?.abort()
    usRequest.current?.abort()
    setLoading(true)
    setConnection(null)
    setSnapshot(null)
    setUsConnection(null)
    setUsSnapshot(null)
    setVenue(null)
    setError('')
    setSyncError('')
    setUsSyncError('')
    setRefreshing(false)
    setUsRefreshing(false)
    try {
      const [data, usData] = await Promise.all([loadConnection(), loadUSConnection()])
      if (run !== generation.current || !alive.current) return
      setConnection(data)
      if (usRun === usGeneration.current) setUsConnection(usData)
    } catch (e) { if (run === generation.current && alive.current) setError((e as Error).message) }
    finally { if (run === generation.current && alive.current) setLoading(false) }
  }, [])

  useEffect(() => {
    alive.current = true
    const start = window.setTimeout(() => void initialize(), 0)
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // Supabase re-fires SIGNED_IN when a backgrounded tab regains focus and
      // revalidates its session, even for the same user — only reinitialize
      // (which closes any open dialog) on an actual sign-in/sign-out change,
      // not a redundant re-fire for the user already loaded.
      const userId = session?.user?.id ?? null
      if (event === 'SIGNED_OUT') { lastUserId.current = null; void initialize(); return }
      if (event === 'SIGNED_IN' && userId !== lastUserId.current) { lastUserId.current = userId; void initialize() }
    })
    return () => {
      clearTimeout(start)
      alive.current = false
      // This is an operation generation, not a DOM ref; invalidate pending work.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++
      // eslint-disable-next-line react-hooks/exhaustive-deps
      usGeneration.current++
      request.current?.abort()
      usRequest.current?.abort()
      data.subscription.unsubscribe()
    }
  }, [initialize])

  const address = connection?.wallet_address
  useEffect(() => {
    if (!address) return
    // Defer the first refresh so the effect only schedules external work.
    const start = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearTimeout(start); clearInterval(timer); request.current?.abort(); document.removeEventListener('visibilitychange', onVisible) }
  }, [address, refresh])

  const usKeyId = usConnection?.status === 'active' ? usConnection.key_id : undefined
  useEffect(() => {
    if (!usKeyId) return
    const start = window.setTimeout(() => void usRefresh(), 0)
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void usRefresh() }, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void usRefresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearTimeout(start); clearInterval(timer); usRequest.current?.abort(); document.removeEventListener('visibilitychange', onVisible) }
  }, [usKeyId, usRefresh])

  function connected(value: Connection) {
    generation.current++
    request.current?.abort()
    setSnapshot(null)
    setConnection(value)
    setVenue(null)
    setError('')
    setSyncError('')
    setConfirmDisconnect(false)
    // Also refresh if verifying a profile that was already being tracked.
    void refresh()
  }

  function connectedUS(value: USConnection) {
    usGeneration.current++
    usRequest.current?.abort()
    setUsSnapshot(null)
    setUsConnection(value)
    setVenue(null)
    setUsSyncError('')
    setUsConfirmDisconnect(false)
    void usRefresh()
  }

  async function disconnect() {
    generation.current++
    request.current?.abort()
    setDisconnecting(true)
    setRefreshing(false)
    setError('')
    try {
      await connectionRequest({ action: 'disconnect' })
      if (!alive.current) return
      setConnection(null)
      setSnapshot(null)
      setSyncError('')
      setConfirmDisconnect(false)
    } catch (e) { if (alive.current) setError((e as Error).message) }
    finally { if (alive.current) setDisconnecting(false) }
  }

  async function disconnectUS() {
    usGeneration.current++
    usRequest.current?.abort()
    setUsDisconnecting(true)
    setUsRefreshing(false)
    try {
      await connectionRequest({ action: 'disconnect' }, undefined, 'polymarket-us-connect')
      if (!alive.current) return
      setUsConnection(null)
      setUsSnapshot(null)
      setUsSyncError('')
      setUsConfirmDisconnect(false)
    } catch (e) { if (alive.current) setUsSyncError((e as Error).message) }
    finally { if (alive.current) setUsDisconnecting(false) }
  }

  const positions = snapshot?.positions ?? []
  const activity = snapshot?.activity ?? []
  const positionValue = positions.length && positions.some(p => p.current_value == null) ? null : positions.reduce((sum, p) => sum + (p.current_value ?? 0), 0)

  return <div className="sig-page connections-page">
    <div className="app-section-header"><div><span className="connection-eyebrow">YOUR ACCOUNTS</span><h1 className="app-section-title">Stay connected.</h1><p className="app-section-sub">Your prediction markets, together in one place.</p></div><span className="connection-header-icon" aria-hidden="true"><Link2 size={28} /></span></div>
    {error && <div className="connection-error" role="alert">{error} <button type="button" className="connection-text-link" onClick={() => void initialize()}>Retry</button></div>}
    <div className="connection-cards" aria-busy={loading}>
      <section className={`connection-card ${connection ? 'is-connected' : ''}`} aria-labelledby="international-title">
        <div className="connection-card-top"><span className="connection-venue-icon"><Globe2 size={25} /></span><span className={`connection-badge ${connection ? 'connected' : ''}`}>{loading ? 'Loading…' : connection ? <><Check size={12} /> {connection.verified_at ? 'Wallet verified' : 'Tracking active'}</> : 'International'}</span></div>
        <h2 id="international-title">Polymarket</h2>
        <p>{connection ? 'Your account is linked. Follow your positions and recent trades below.' : 'Connect your existing wallet or track your public profile. Your positions come with you.'}</p>
        {connection ? <>
          <div className="connection-account ph-no-capture ph-mask"><Wallet size={18} /><div><strong>{connection.display_name}</strong><a href={`https://polymarket.com/profile/${connection.wallet_address}`} target="_blank" rel="noopener noreferrer">{shortAddress(connection.wallet_address)} <ArrowUpRight size={12} /></a></div></div>
          <div className="connection-card-actions">
            {!connection.verified_at && <button type="button" className="connection-button" disabled={disconnecting} onClick={() => setVenue('international')}>Verify with wallet</button>}
            <button type="button" className="connection-text-link" disabled={disconnecting} onClick={() => setConfirmDisconnect(true)}><Unplug size={14} /> Disconnect</button>
          </div>
          {confirmDisconnect && <div className="connection-disconnect" role="group" aria-label="Confirm disconnect"><p>Stop tracking this account? Your funds and positions stay on Polymarket.</p><div><button className="connection-button" type="button" disabled={disconnecting} onClick={() => void disconnect()}>{disconnecting ? 'Disconnecting…' : 'Disconnect account'}</button><button type="button" className="connection-text-link" disabled={disconnecting} onClick={() => setConfirmDisconnect(false)}>Keep connected</button></div></div>}
        </> : <button type="button" className="connection-button connection-button-primary" disabled={loading || Boolean(error)} onClick={() => setVenue('international')}><Wallet size={17} /> Connect Polymarket <ArrowUpRight size={17} /></button>}
        <div className="connection-card-foot"><ShieldCheck size={14} /> Portfolio tracking · no trading permission requested</div>
      </section>
      <section className={`connection-card connection-us ${usConnection ? 'is-connected' : ''}`} aria-labelledby="us-title">
        <div className="connection-card-top"><span className="connection-venue-icon connection-us-icon" aria-hidden="true">US</span>
          <span className={`connection-badge ${usConnection ? 'connected' : ''}`}>{loading ? 'Loading…' : usConnection ? (usConnection.status === 'needs_reconnect' ? 'Needs reconnect' : <><Check size={12} /> Connected</>) : 'Polymarket US'}</span></div>
        <h2 id="us-title">Polymarket US</h2>
        <p>{usConnection ? 'Your account is linked. Follow your positions and recent trades below.' : 'Connect your US account with an API key. Keep your trading history close, without the spreadsheets.'}</p>
        {usConnection ? <>
          <div className="connection-account ph-no-capture ph-mask"><Wallet size={18} /><div><strong>Polymarket US</strong><span>{shortAddress(usConnection.key_id)}</span></div></div>
          <div className="connection-card-actions">
            {usConnection.status === 'needs_reconnect' && <button type="button" className="connection-button" disabled={usDisconnecting} onClick={() => setVenue('us')}>Reconnect</button>}
            <button type="button" className="connection-text-link" disabled={usDisconnecting} onClick={() => setUsConfirmDisconnect(true)}><Unplug size={14} /> Disconnect</button>
          </div>
          {usConfirmDisconnect && <div className="connection-disconnect" role="group" aria-label="Confirm disconnect"><p>Stop tracking this account? Your funds and positions stay on Polymarket US.</p><div><button className="connection-button" type="button" disabled={usDisconnecting} onClick={() => void disconnectUS()}>{usDisconnecting ? 'Disconnecting…' : 'Disconnect account'}</button><button type="button" className="connection-text-link" disabled={usDisconnecting} onClick={() => setUsConfirmDisconnect(false)}>Keep connected</button></div></div>}
        </> : <button type="button" className="connection-button connection-button-primary" disabled={loading || Boolean(error)} onClick={() => setVenue('us')}><Wallet size={17} /> Connect Polymarket US <ArrowUpRight size={17} /></button>}
        <div className="connection-card-foot"><ShieldCheck size={14} /> Portfolio tracking · trading disabled</div>
      </section>
    </div>
    {connection ? <section className="connection-portfolio ph-no-capture ph-mask" aria-label="Connected Polymarket portfolio" aria-busy={refreshing}>
      <div className="connection-portfolio-head"><div><h2>Your Polymarket account</h2><p>{snapshot?.fetched_at ? `Updated ${new Date(snapshot.fetched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · refreshes every minute while this page is open` : 'Fetching your positions and recent trades…'}</p></div><button className="connection-button" type="button" onClick={() => void refresh()} disabled={refreshing || disconnecting}><RefreshCw size={15} className={refreshing ? 'connection-spin' : ''} /> Refresh</button></div>
      {syncError && <p className="connection-error" role="alert">{syncError} {snapshot ? 'Showing the last successful update.' : 'Your connection is saved. Refresh to try again.'}</p>}
      <div className="connection-metrics"><div><span>Value of displayed positions</span><strong>{snapshot ? money(positionValue) : '—'}</strong></div><div><span>Positions displayed</span><strong>{snapshot ? positions.length : '—'}</strong></div><div><span>Connection access</span><strong className="connection-metric-label">Tracking only</strong></div></div>
      <div className="connection-tabs"><button type="button" aria-pressed={tab === 'positions'} onClick={() => setTab('positions')}>Positions</button><button type="button" aria-pressed={tab === 'activity'} onClick={() => setTab('activity')}>Recent trades</button></div>
      {snapshot && (tab === 'positions' ? <>
        {snapshot.positions_limited && <p className="connection-small">Showing your 100 largest positions. Totals above cover these positions only.</p>}
        {positions.length ? <div className="connection-table-wrap"><table><thead><tr><th>Market</th><th>Shares</th><th>Value</th><th>Position P&amp;L</th></tr></thead><tbody>{positions.map((p, index) => <tr key={`${p.asset}-${index}`}><td><strong>{p.title}</strong><span>{p.outcome}{p.redeemable ? ' · Redeemable' : ''}</span></td><td>{p.size?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'}</td><td>{money(p.current_value)}</td><td className={(p.cash_pnl ?? 0) < 0 ? 'negative' : (p.cash_pnl ?? 0) > 0 ? 'positive' : ''}>{money(p.cash_pnl)}</td></tr>)}</tbody></table></div> : <div className="connection-empty"><Wallet size={24} /><h3>No positions to display</h3><p>Positions reported by Polymarket will appear here when available.</p></div>}
      </> : <>
        <p className="connection-small">Latest 50 trades, including trades placed on Polymarket. This is not a complete trading history.</p>
        {activity.length ? <div className="connection-table-wrap"><table><thead><tr><th>Market</th><th>Action</th><th>Amount</th><th>Time</th></tr></thead><tbody>{activity.map((a, index) => <tr key={`${a.transaction_hash}-${a.asset}-${index}`}><td><strong>{a.title}</strong><span>{a.outcome}</span></td><td>{a.side}</td><td>{money(a.amount)}</td><td>{a.timestamp == null ? '—' : new Date(a.timestamp * 1000).toLocaleString()}</td></tr>)}</tbody></table></div> : <div className="connection-empty"><h3>No recent trades</h3><p>New trades will appear on the next refresh.</p></div>}
      </>)}
      {!snapshot && <p className="connection-small" role="status">{syncError ? 'Portfolio data is currently unavailable.' : 'Loading portfolio…'}</p>}
      <p className="connection-small">Account activity is separate from the P&amp;L you manually log in your journal.</p>
    </section> : !loading && !error && !usConnection && <div className="connection-empty-state"><div className="connection-empty-lines" aria-hidden="true"><span /><span /><span /></div><h2>A clearer picture of your trading.</h2><p>Connect an account to see positions and recent trades here.<br />Your manual journal stays yours.</p></div>}
    {usConnection && <section className="connection-portfolio ph-no-capture ph-mask" aria-label="Connected Polymarket US portfolio" aria-busy={usRefreshing}>
      <div className="connection-portfolio-head"><div><h2>Your Polymarket US account</h2><p>{usSnapshot?.fetched_at ? `Updated ${new Date(usSnapshot.fetched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · refreshes every minute while this page is open` : 'Fetching your positions and recent trades…'}</p></div><button className="connection-button" type="button" onClick={() => void usRefresh()} disabled={usRefreshing || usDisconnecting}><RefreshCw size={15} className={usRefreshing ? 'connection-spin' : ''} /> Refresh</button></div>
      {usSyncError && <p className="connection-error" role="alert">{usSyncError} {usSnapshot ? 'Showing the last successful update.' : 'Your connection is saved. Refresh to try again.'}</p>}
      {(() => {
        const usPositions = usSnapshot?.positions ?? []
        const usActivity = usSnapshot?.activity ?? []
        const usPositionValue = usPositions.length && usPositions.some(p => p.current_value == null) ? null : usPositions.reduce((sum, p) => sum + (p.current_value ?? 0), 0)
        return <>
          <div className="connection-metrics"><div><span>Value of displayed positions</span><strong>{usSnapshot ? money(usPositionValue) : '—'}</strong></div><div><span>Positions displayed</span><strong>{usSnapshot ? usPositions.length : '—'}</strong></div><div><span>Connection access</span><strong className="connection-metric-label">Tracking only</strong></div></div>
          <div className="connection-tabs"><button type="button" aria-pressed={usTab === 'positions'} onClick={() => setUsTab('positions')}>Positions</button><button type="button" aria-pressed={usTab === 'activity'} onClick={() => setUsTab('activity')}>Recent trades</button></div>
          {usSnapshot && (usTab === 'positions' ? <>
            {usSnapshot.positions_limited && <p className="connection-small">Showing your 100 largest positions. Totals above cover these positions only.</p>}
            {usPositions.length ? <div className="connection-table-wrap"><table><thead><tr><th>Market</th><th>Shares</th><th>Value</th><th>Position P&amp;L</th></tr></thead><tbody>{usPositions.map((p, index) => <tr key={`${p.asset}-${index}`}><td><strong>{p.title}</strong><span>{p.outcome}{p.redeemable ? ' · Redeemable' : ''}</span></td><td>{p.size?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'}</td><td>{money(p.current_value)}</td><td className={(p.cash_pnl ?? 0) < 0 ? 'negative' : (p.cash_pnl ?? 0) > 0 ? 'positive' : ''}>{money(p.cash_pnl)}</td></tr>)}</tbody></table></div> : <div className="connection-empty"><Wallet size={24} /><h3>No positions to display</h3><p>Positions reported by Polymarket US will appear here when available.</p></div>}
          </> : <>
            <p className="connection-small">Latest 50 trades. This is not a complete trading history.</p>
            {usActivity.length ? <div className="connection-table-wrap"><table><thead><tr><th>Market</th><th>Action</th><th>Amount</th><th>Time</th></tr></thead><tbody>{usActivity.map((a, index) => <tr key={`${a.transaction_hash}-${a.asset}-${index}`}><td><strong>{a.title}</strong><span>{a.outcome}</span></td><td>{a.side}</td><td>{money(a.amount)}</td><td>{a.timestamp == null ? '—' : new Date(a.timestamp * 1000).toLocaleString()}</td></tr>)}</tbody></table></div> : <div className="connection-empty"><h3>No recent trades</h3><p>New trades will appear on the next refresh.</p></div>}
          </>)}
        </>
      })()}
      {!usSnapshot && <p className="connection-small" role="status">{usSyncError ? 'Portfolio data is currently unavailable.' : 'Loading portfolio…'}</p>}
      <p className="connection-small">Account activity is separate from the P&amp;L you manually log in your journal.</p>
    </section>}
    {venue && <ConnectDialog venue={venue} onClose={() => setVenue(null)} onConnected={connected} onConnectedUS={connectedUS} />}
  </div>
}
