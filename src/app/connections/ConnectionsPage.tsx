import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, Plus, RefreshCw, Settings2, ShieldCheck, Unplug, Wallet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import ConnectDialog from './ConnectDialog'
import { connectionRequest, loadConnection, loadUSConnection, money, shortAddress } from './api'
import type { Connection, Snapshot, USConnection, USSnapshot } from './api'
import { Link } from 'react-router-dom'
import { dashboardPath } from '../../lib/domains'
import JournalCalendar from '../JournalCalendar'
import './connections.css'

export default function ConnectionsPage({ journal = false }: { journal?: boolean }) {
  const [connection, setConnection] = useState<Connection | null>(null)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [venue, setVenue] = useState<'international' | 'us' | 'choose' | null>(null)
  const [tab, setTab] = useState<'overview' | 'trades' | 'calendar'>('overview')
  const [account, setAccount] = useState<'international' | 'us'>('international')
  const [noteDay, setNoteDay] = useState<string>()
  const [notice, setNotice] = useState('')
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
  const [usConfirmDisconnect, setUsConfirmDisconnect] = useState(false)
  const [usDisconnecting, setUsDisconnecting] = useState(false)
  const usRequest = useRef<AbortController | null>(null)
  const usGeneration = useRef(0)
  const usBackfilling = useRef(false)
  const [backfilling, setBackfilling] = useState(false)
  const [backfillImported, setBackfillImported] = useState(0)

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
    if (!address || !journal) return
    // Defer the first refresh so the effect only schedules external work.
    const start = window.setTimeout(() => void refresh(), 0)
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearTimeout(start); clearInterval(timer); request.current?.abort(); document.removeEventListener('visibilitychange', onVisible) }
  }, [address, refresh, journal])

  const runUSBackfill = useCallback(async () => {
    if (usBackfilling.current) return
    usBackfilling.current = true
    setBackfilling(true)
    setBackfillImported(0)
    let total = 0
    try {
      for (;;) {
        const result = await connectionRequest<{ done: boolean; imported: number }>({ action: 'backfill' }, undefined, 'polymarket-us-connect')
        total += result.imported
        if (!alive.current) return
        setBackfillImported(total)
        if (result.done) {
          setUsConnection(c => c ? { ...c, backfill_status: 'done' } : c)
          break
        }
      }
    } catch {
      // Server-side status stays in_progress/pending on failure; the effect
      // below will retry next time this connection is loaded.
    } finally {
      usBackfilling.current = false
      if (alive.current) setBackfilling(false)
    }
  }, [])

  const usBackfillStatus = usConnection?.backfill_status
  useEffect(() => {
    if (!usBackfillStatus || usBackfillStatus === 'done') return
    const start = window.setTimeout(() => void runUSBackfill(), 0)
    return () => clearTimeout(start)
  }, [usBackfillStatus, runUSBackfill])

  const usKeyId = usConnection?.status === 'active' ? usConnection.key_id : undefined
  useEffect(() => {
    if (!usKeyId || !journal) return
    const start = window.setTimeout(() => void usRefresh(), 0)
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void usRefresh() }, 60_000)
    const onVisible = () => { if (document.visibilityState === 'visible') void usRefresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => { clearTimeout(start); clearInterval(timer); usRequest.current?.abort(); document.removeEventListener('visibilitychange', onVisible) }
  }, [usKeyId, usRefresh, journal])

  function connected(value: Connection) {
    generation.current++
    request.current?.abort()
    setSnapshot(null)
    setConnection(value)
    setAccount('international')
    setNotice('Polymarket connected. Your recent activity is ready to review in Journal.')
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
    setAccount('us')
    setNotice('Polymarket US connected. Your recent activity is ready to review in Journal.')
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
      setNotice('Polymarket disconnected. Your daily journal entries are saved.')
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
      setNotice('Polymarket US disconnected. Your daily journal entries are saved.')
      setUsSnapshot(null)
      setUsSyncError('')
      setUsConfirmDisconnect(false)
    } catch (e) { if (alive.current) setUsSyncError((e as Error).message) }
    finally { if (alive.current) setUsDisconnecting(false) }
  }

  const selected = account === 'us' ? (usConnection ? 'us' : 'international') : (connection ? 'international' : 'us')
  const current = selected === 'us' ? usSnapshot : snapshot
  const resourceErrors = selected === 'us' ? usSnapshot?.resource_errors : undefined
  const partial = Boolean(resourceErrors?.positions || resourceErrors?.activity)
  const currentError = selected === 'us' ? usSyncError : syncError
  const isRefreshing = selected === 'us' ? usRefreshing : refreshing
  const positions = current?.positions ?? []
  const activity = current?.activity ?? []
  const hasAccount = Boolean(connection || usConnection)
  const value = positions.some(p => p.current_value == null) ? null : positions.reduce((sum, p) => sum + (p.current_value ?? 0), 0)
  const allActivity = [
    ...(snapshot?.activity ?? []).map(a => ({ ...a, venue: 'Polymarket' })),
    ...(usSnapshot?.activity ?? []).map(a => ({ ...a, venue: 'Polymarket US' })),
  ]
  const reviewDay = (timestamp: number) => {
    const date = new Date(timestamp * 1000)
    setNoteDay(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`)
    setTab('calendar')
  }

  return <div className={`sig-page connections-page ${journal ? 'journal-hub' : 'connection-settings'}`}>
    {!journal && <Link className="connection-text-link" to={dashboardPath('/settings')}><ArrowLeft size={15} /> Settings</Link>}
    <header className="app-section-header">
      <div><span className="connection-eyebrow">{journal ? 'YOUR TRADING, IN PERSPECTIVE' : 'SETTINGS / CONNECTIONS'}</span><h1 className="app-section-title">{journal ? 'Journal' : 'Connections'}</h1><p className="app-section-sub">{journal ? 'Follow your positions. Reflect on your decisions.' : 'The accounts behind your trading journal.'}</p></div>
      <div className="connection-header-actions">
        {journal && hasAccount && <label className="connection-account-select"><Wallet size={15} /><select aria-label="Trading account" value={selected} onChange={e => setAccount(e.target.value as 'international' | 'us')}>
          {connection && <option value="international">Polymarket · {connection.display_name}</option>}
          {usConnection && <option value="us">Polymarket US</option>}
        </select></label>}
        <button className="connection-button" disabled={loading || Boolean(error)} onClick={() => setVenue('choose')}><Plus size={16} /> Connect account</button>
        {journal && <Link className="connection-icon-button" aria-label="Manage connections" title="Manage connections" to={dashboardPath('/settings/connections')}><Settings2 size={18} /></Link>}
      </div>
    </header>
    {notice && <div className="connection-success" role="status"><Check size={17} /><span>{notice}</span>{!journal && <Link to={dashboardPath('/journal')}>Open Journal <ChevronRight size={14} /></Link>}</div>}
    {error && <div className="connection-error" role="alert">{error} <button className="connection-text-link" onClick={() => void initialize()}>Try again</button></div>}
    {backfilling && <p className="connection-progress" role="status"><span className="connection-spinner" />Importing your Polymarket US trade history… {backfillImported} trade{backfillImported === 1 ? '' : 's'} so far</p>}
    {loading && <div className="connection-loading" role="status"><span className="connection-spinner" /> Loading your accounts…</div>}

    {!journal && !loading && <div className="connection-manage-list">
      <section className="connection-manage-row">
        <img className="connection-brand" src="/polymarket.png" alt="" />
        <div className="connection-manage-info"><h2>Polymarket <span>International</span></h2><p className="ph-no-capture ph-mask">{connection ? `${connection.display_name} · ${shortAddress(connection.wallet_address)}` : 'Connect a wallet or follow a public profile.'}</p>
          {connection && <span className="connection-status"><span />{connection.verified_at ? 'Wallet verified' : 'Public profile · ownership not verified'}</span>}
        </div>
        <div className="connection-row-actions">{connection ? <>
          {!connection.verified_at && <button className="connection-button" onClick={() => setVenue('international')}>Verify wallet</button>}
          <button className="connection-icon-button" disabled={disconnecting} aria-label="Disconnect Polymarket" onClick={() => setConfirmDisconnect(true)}><Unplug size={17} /></button>
        </> : <button className="connection-button" disabled={Boolean(error)} onClick={() => setVenue('international')}>Connect <ChevronRight size={15} /></button>}</div>
        {confirmDisconnect && <div className="connection-disconnect"><p>Disconnect Polymarket? Account activity will stop appearing here. Your saved daily entries and funds are unaffected.</p><div><button className="connection-button" disabled={disconnecting} onClick={() => void disconnect()}>{disconnecting ? 'Disconnecting…' : 'Disconnect'}</button><button className="connection-text-link" disabled={disconnecting} onClick={() => setConfirmDisconnect(false)}>Cancel</button></div></div>}
      </section>
      <section className="connection-manage-row">
        <span className="connection-brand connection-brand-us">US</span>
        <div className="connection-manage-info"><h2>Polymarket US</h2><p>{usConnection ? 'Linked with a dedicated API key' : 'Bring your US positions and recent activity into Journal.'}</p>
          {usConnection && <span className={`connection-status ${usConnection.status !== 'active' ? 'needs-attention' : ''}`}><span />{usConnection.status === 'active' ? 'Connected' : 'Reconnect to restore access'}</span>}
        </div>
        <div className="connection-row-actions">{usConnection ? <>
          {usConnection.status !== 'active' && <button className="connection-button" onClick={() => setVenue('us')}>Reconnect</button>}
          <button className="connection-icon-button" disabled={usDisconnecting} aria-label="Disconnect Polymarket US" onClick={() => setUsConfirmDisconnect(true)}><Unplug size={17} /></button>
        </> : <button className="connection-button" disabled={Boolean(error)} onClick={() => setVenue('us')}>Connect <ChevronRight size={15} /></button>}</div>
        {usConfirmDisconnect && <div className="connection-disconnect"><p>Disconnect Polymarket US? Your saved daily entries and funds are unaffected.</p><div><button className="connection-button" disabled={usDisconnecting} onClick={() => void disconnectUS()}>{usDisconnecting ? 'Disconnecting…' : 'Disconnect'}</button><button className="connection-text-link" disabled={usDisconnecting} onClick={() => setUsConfirmDisconnect(false)}>Cancel</button></div></div>}
        {usSyncError && <p className="connection-error" role="alert">{usSyncError}</p>}
      </section>
      <div className="connection-settings-foot"><ShieldCheck size={18} /><p>These connections are used to read positions and activity. VisibleTrader does not place trades or move funds through this connection.</p><Link className="connection-text-link" to={dashboardPath('/journal')}>Go to Journal <ArrowUpRight size={14} /></Link></div>
    </div>}

    {journal && <>
      {resourceErrors && Object.entries(resourceErrors).map(([resource, message]) => <div className="connection-error" role="status" key={resource}>{message}</div>)}
      <nav className="journal-view-tabs" aria-label="Journal views">{(['overview', 'trades', 'calendar'] as const).map(view => <button key={view} aria-current={tab === view ? 'page' : undefined} onClick={() => { setNoteDay(undefined); setTab(view) }}>{view === 'overview' ? 'Overview' : view === 'trades' ? 'Trades' : 'Calendar'}</button>)}</nav>
      {!loading && !error && !hasAccount && tab !== 'calendar' && <section className="connection-welcome">
        <div className="connection-welcome-mark"><Wallet size={28} /></div><span className="connection-eyebrow">A LITTLE CONTEXT GOES A LONG WAY</span>
        <h2>Your trading story<br />starts here.</h2><p>Connect Polymarket to see your positions and recent trades alongside your daily journal.</p>
        <button className="connection-button connection-button-primary" onClick={() => setVenue('choose')}>Connect your account <ArrowUpRight size={17} /></button>
        <button className="connection-text-link" onClick={() => setTab('calendar')}>Start with a manual entry</button>
        <div className="connection-welcome-benefits"><span>01 &nbsp; See your positions</span><span>02 &nbsp; Review your trades</span><span>03 &nbsp; Record what you learned</span></div>
      </section>}
      {hasAccount && tab !== 'calendar' && <>
        <div className="connection-sync-row"><span className={`connection-status ${currentError || partial ? 'needs-attention' : ''}`}><span />{isRefreshing ? 'Updating account…' : currentError ? 'Update interrupted' : partial ? 'Account connected · partial update' : current?.fetched_at ? `Updated ${new Date(current.fetched_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'Waiting for account data'}</span><button className="connection-text-link" disabled={isRefreshing} onClick={() => void (selected === 'us' ? usRefresh() : refresh())}><RefreshCw size={14} className={isRefreshing ? 'connection-spin' : ''} /> Refresh</button></div>
        {selected === 'us' && usConnection?.status !== 'active' && <div className="connection-error">Your US account needs to be reconnected. <button className="connection-text-link" onClick={() => setVenue('us')}>Reconnect</button></div>}
        {currentError && <div className="connection-error" role="alert">{currentError} {current ? 'Showing the last successful update.' : 'Try refreshing your account.'}</div>}
        {!current && !currentError && <p className="connection-small" role="status">Loading positions and recent activity…</p>}
        {tab === 'overview' && <>
          <div className="connection-metrics ph-no-capture ph-mask"><div><span>Displayed position value</span><strong>{current?.positions ? money(value) : '—'}</strong></div><div><span>Positions displayed</span><strong>{current?.positions ? positions.length : '—'}</strong></div><div><span>Recent trades available</span><strong>{current?.activity ? activity.length : '—'}</strong></div></div>
          <div className="connection-section-heading"><h2>Positions</h2><span>{selected === 'us' ? 'Polymarket US' : 'Polymarket'}</span></div>
          {current?.positions_limited && <p className="connection-small">Showing up to 100 positions. Value covers displayed positions only.</p>}
          {current?.positions && (positions.length ? <div className="connection-table-wrap ph-no-capture ph-mask"><table><thead><tr><th>Market / outcome</th><th>Shares</th><th>Value</th><th>Position P&amp;L</th></tr></thead><tbody>{positions.map((p, i) => <tr key={`${p.asset}-${i}`}><td><strong>{p.title}</strong><span>{p.outcome}{p.redeemable ? ' · Redeemable' : ''}</span></td><td>{p.size?.toLocaleString(undefined, { maximumFractionDigits: 2 }) ?? '—'}</td><td>{money(p.current_value)}</td><td className={(p.cash_pnl ?? 0) < 0 ? 'negative' : 'positive'}>{money(p.cash_pnl)}</td></tr>)}</tbody></table></div> : <div className="connection-empty"><Wallet size={24} /><h3>No positions right now</h3><p>Your account is connected. Positions will appear here when reported.</p></div>)}
          <button className="journal-reflection-prompt" onClick={() => { setNoteDay(undefined); setTab('calendar') }}><div><span>MAKE IT A HABIT</span><h3>What did you learn today?</h3><p>Add a daily reflection and log your result.</p></div><ChevronRight size={22} /></button>
        </>}
        {tab === 'trades' && <><div className="connection-section-heading"><h2>Recent trades</h2><span>{current?.activity_limited ? 'Latest 500 per account' : 'History loaded'}</span></div><p className="connection-small">Review a trade to see its day in your journal and add a reflection. Trade amounts are not realized P&amp;L.{current?.activity_limited ? ' The provider limited this history window; older trades may not be available.' : ''}</p>
          {current?.activity && (activity.length ? <div className="connection-trade-list ph-no-capture ph-mask">{activity.map((a, i) => <article className="connection-trade-row" key={`${a.transaction_hash}-${a.asset}-${i}`}><span className={`connection-side ${a.side.toLowerCase() === 'sell' ? 'is-sell' : ''}`}>{a.side}</span><div><h3>{a.title}</h3><p>{a.outcome} · {a.timestamp == null ? 'Time unavailable' : new Date(a.timestamp * 1000).toLocaleString()}</p><small>{a.size == null ? '—' : a.size.toLocaleString()} shares · {a.price == null ? 'Price unavailable' : money(a.price) + ' / share'}</small></div><strong>{money(a.amount)}</strong><button className="connection-text-link" disabled={a.timestamp == null} onClick={() => a.timestamp != null && reviewDay(a.timestamp)}>Review day <ChevronRight size={14} /></button></article>)}</div> : <div className="connection-empty"><h3>No recent trades</h3><p>Your recent activity will appear after your next trade.</p></div>)}
        </>}
      </>}
      {tab === 'calendar' && <><p className="connection-small">Daily results and notes cover your personal journal. Account activity includes the fetched trade history across connected accounts.{(snapshot?.activity_limited || usSnapshot?.activity_limited) ? ' The provider limited the history window, so older trades may be missing.' : ''} P&amp;L is manually logged.</p><JournalCalendar key={noteDay ?? 'calendar'} activity={allActivity} initialDay={noteDay} /></>}
    </>}
    {venue && <ConnectDialog venue={venue} onClose={() => setVenue(null)} onConnected={connected} onConnectedUS={connectedUS} />}
  </div>
}
