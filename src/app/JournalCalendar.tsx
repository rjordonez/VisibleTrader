import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { ChevronLeft, ChevronRight, X, ArrowUpRight, Share2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmtSigned } from './helpers'
import { JournalShareModal, type JournalShareData } from './JournalShareCard'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { journalEventPoints } from './journalGraph'
import './journal.css'

interface USTradeRow {
  asset: string
  occurred_at: string
  title: string
  side: string
  size: number | null
  realized_pnl: number | null
  order_id: string | null
}
interface TradeGroup {
  key: string
  title: string
  side: 'Position' | 'Entry' | 'Settlement'
  occurred_at: string
  fills: number
  size: number | null
  realized_pnl: number | null
}

// Polymarket's own title metadata is sometimes blank (falls back to the raw
// slug elsewhere), and it isn't always populated consistently between a
// trade and its settlement for the same market — prefer whichever of the
// two actually has a human-readable name instead of showing the slug.
function bestTitle(asset: string, ...candidates: string[]) {
  const fallback = asset.replaceAll('-', ' ')
  return candidates.find(t => t && t !== fallback) ?? candidates.find(Boolean) ?? fallback
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function toISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Two things collapse here, both because the raw per-fill activity feed is
// far more granular than what a person thinks of as "a trade":
// 1. A single order on a thin order book can fill in many pieces, each a
//    genuine separate activity row. Grouped by Polymarket's own order id —
//    a resting order can fill at different times, not necessarily the same
//    instant, so matching by timestamp (an earlier version of this) missed
//    fills that landed apart in time.
// 2. If a position both has entry fills and a settlement for the same
//    market on the same day, showing them as two rows is redundant — the
//    settlement is already the final, complete answer for that position.
//    They're merged into one row carrying the settlement's real P&L.
// A position still open (no settlement yet) keeps showing as its own Entry
// row with no P&L, since there's nothing final to report yet.
function groupTrades(rows: USTradeRow[]): TradeGroup[] {
  const entries = new Map<string, { asset: string; title: string; occurred_at: string; fills: number; size: number | null }>()
  const settlements = new Map<string, { title: string; occurred_at: string; realized_pnl: number }>()
  let fallbackIndex = 0
  for (const row of rows) {
    if (row.side === 'Settlement') {
      settlements.set(row.asset, { title: row.title, occurred_at: row.occurred_at, realized_pnl: row.realized_pnl ?? 0 })
      continue
    }
    const key = row.order_id ?? `row:${fallbackIndex++}`
    const existing = entries.get(key)
    if (existing) { existing.fills += 1; existing.size = (existing.size ?? 0) + (row.size ?? 0) }
    else entries.set(key, { asset: row.asset, title: row.title, occurred_at: row.occurred_at, fills: 1, size: row.size })
  }

  const closedAssets = new Map<string, TradeGroup>()
  const result: TradeGroup[] = []
  for (const entry of entries.values()) {
    const settlement = settlements.get(entry.asset)
    if (!settlement) { result.push({ key: entry.asset, title: entry.title, side: 'Entry', occurred_at: entry.occurred_at, fills: entry.fills, size: entry.size, realized_pnl: null }); continue }
    const existing = closedAssets.get(entry.asset)
    if (existing) { existing.fills += entry.fills; existing.size = (existing.size ?? 0) + (entry.size ?? 0) }
    else {
      const group: TradeGroup = { key: entry.asset, title: bestTitle(entry.asset, settlement.title, entry.title), side: 'Position', occurred_at: settlement.occurred_at, fills: entry.fills, size: entry.size, realized_pnl: settlement.realized_pnl }
      closedAssets.set(entry.asset, group)
      result.push(group)
    }
  }
  // A settlement with no entry fills captured this period (e.g. the position
  // was opened before the connected history began) still needs to be shown.
  for (const [asset, settlement] of settlements) {
    if (!closedAssets.has(asset)) result.push({ key: asset, title: bestTitle(asset, settlement.title), side: 'Settlement', occurred_at: settlement.occurred_at, fills: 1, size: null, realized_pnl: settlement.realized_pnl })
  }
  return result.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
}

function JournalCalendar({ initialDay }: { initialDay?: string }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [authReady, setAuthReady] = useState(false)
  const [viewDate, setViewDate] = useState(() => initialDay ? new Date(initialDay + 'T00:00:00') : new Date())
  const [view, setView] = useState<'calendar' | 'graph'>('calendar')
  const [statsRange, setStatsRange] = useState<'month' | 'year' | 'all'>('month')
  const [result, setResult] = useState<{ key: string; rows: USTradeRow[]; error: boolean }>({ key: '', rows: [], error: false })
  const [editingDate, setEditingDate] = useState<string | null>(initialDay ?? null)
  const [selectedTrade, setSelectedTrade] = useState<USTradeRow | null>(null)
  const editorRef = useRef<HTMLDialogElement>(null)
  const tradeDialogRef = useRef<HTMLDialogElement>(null)
  const [shareData, setShareData] = useState<JournalShareData | null>(null)
  const closeShare = useCallback(() => setShareData(null), [])
  const year = viewDate.getFullYear(), month = viewDate.getMonth()
  const monthLabel = viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const summaryLabel = statsRange === 'month' ? monthLabel : statsRange === 'year' ? String(year) : 'All time'
  const from = statsRange === 'all' ? null : new Date(year, statsRange === 'year' ? 0 : month, 1).toISOString()
  const to = statsRange === 'all' ? null : new Date(statsRange === 'year' ? year + 1 : year, statsRange === 'year' ? 0 : month + 1, 1).toISOString()
  const rangeKey = `${userId}:${from}:${to}`
  const loading = !authReady || Boolean(userId && result.key !== rangeKey)
  const loadError = result.key === rangeKey && result.error
  const trades = useMemo(() => result.key === rangeKey ? result.rows : [], [result, rangeKey])

  useEffect(() => {
    let active = true
    supabase.auth.getUser().then(({ data }) => { if (active) setUserId(data.user?.id ?? null) })
      .finally(() => { if (active) setAuthReady(true) }).catch(() => {})
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!userId) return
    let active = true
    async function load() {
      const rows: USTradeRow[] = []
      for (let offset = 0; ; offset += 1000) {
        let query = supabase.from('polymarket_trades').select('external_id, asset, occurred_at, title, side, size, realized_pnl, order_id')
          .eq('venue', 'us').order('occurred_at', { ascending: true }).order('external_id', { ascending: true }).range(offset, offset + 999)
        if (from && to) query = query.gte('occurred_at', from).lt('occurred_at', to)
        const { data, error } = await query
        if (!active) return
        if (error) throw error
        rows.push(...(data ?? []) as USTradeRow[])
        if ((data?.length ?? 0) < 1000) break
      }
      if (active) setResult({ key: rangeKey, rows, error: false })
    }
    void load().catch(() => { if (active) setResult({ key: rangeKey, rows: [], error: true }) })
    return () => { active = false }
  }, [userId, from, to, rangeKey])

  useEffect(() => { if (editingDate) editorRef.current?.showModal(); else editorRef.current?.close() }, [editingDate])
  useEffect(() => { if (selectedTrade) tradeDialogRef.current?.showModal(); else tradeDialogRef.current?.close() }, [selectedTrade])

  const tradesByDay = useMemo(() => {
    const days = new Map<string, USTradeRow[]>()
    for (const trade of trades) {
      const date = toISODate(new Date(trade.occurred_at))
      days.set(date, [...(days.get(date) ?? []), trade])
    }
    return days
  }, [trades])
  const dailyTotals = new Map<string, number>()
  for (const [date, rows] of tradesByDay) {
    if (rows.some(row => row.realized_pnl !== null)) dailyTotals.set(date, rows.reduce((sum, row) => sum + (row.realized_pnl ?? 0), 0))
  }
  const total = Array.from(dailyTotals.values()).reduce((sum, value) => sum + value, 0)
  const bestDay = dailyTotals.size ? Math.max(...dailyTotals.values()) : null
  const graphPoints = journalEventPoints(statsRange === 'all' ? null : year, statsRange === 'month' ? month : null,
    trades.map((trade, tradeIndex) => ({ date: toISODate(new Date(trade.occurred_at)), position: new Date(trade.occurred_at).getTime(), amount: trade.realized_pnl ?? 0, label: trade.title, tradeIndex })),
    from ? new Date(from).getTime() : undefined)
  const todayISO = toISODate(new Date())
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`
  const monthTotals = Array.from(dailyTotals).filter(([date]) => date.startsWith(monthPrefix))
  const openShare = () => {
    const values = monthTotals.map(([, value]) => value)
    setShareData({ monthLabel, year, month, days: new Map(monthTotals.map(([date, value]) => [Number(date.slice(-2)), value])), total: values.reduce((sum, value) => sum + value, 0), daysLogged: values.length, profitableDays: values.filter(value => value > 0).length, bestDay: values.length ? Math.max(...values) : null })
  }
  const canShareMonth = !loading && !loadError && monthTotals.length > 0
  const changePeriod = (direction: number) => setViewDate(new Date(year + (view === 'graph' && statsRange === 'year' ? direction : 0), month + (view === 'graph' && statsRange === 'year' ? 0 : direction), 1))
  const firstWeekday = new Date(year, month, 1).getDay()
  const cells = Array.from({ length: firstWeekday + new Date(year, month + 1, 0).getDate() }, (_, index) => index < firstWeekday ? null : index - firstWeekday + 1)
  const formatDate = (time: number) => new Date(time).toLocaleDateString(undefined, statsRange === 'month' ? { day: 'numeric' } : { month: 'short', day: 'numeric', ...(statsRange === 'all' ? { year: '2-digit' as const } : {}) })

  return <div className="sig-page journal-page">
    <div className="app-section-header journal-header"><h2 className="app-section-title">Your daily record</h2><button type="button" className="journal-add-button journal-share-button" disabled={!canShareMonth} onClick={openShare}><Share2 size={16} /> Share month</button></div>
    <section className="journal-summary" aria-label={`${summaryLabel} summary`}>
      <div className="journal-summary-main"><div className="journal-range-tabs" role="tablist" aria-label="Results period">
        {(['month', 'year', 'all'] as const).map(range => <button type="button" role="tab" key={range} aria-selected={statsRange === range} onClick={() => setStatsRange(range)}>{range === 'all' ? 'All time' : range === 'year' ? 'Year' : 'Month'}</button>)}
      </div><strong className={total < 0 ? 'r' : 'g'}>{loading || loadError ? '—' : fmtSigned(total)}</strong><p>{summaryLabel} · Account P&L</p></div>
      <dl className="journal-summary-details"><div><dt>Trading days</dt><dd>{loading || loadError ? '—' : tradesByDay.size}</dd></div><div><dt>Profitable days</dt><dd>{loading || loadError ? '—' : Array.from(dailyTotals.values()).filter(value => value > 0).length}</dd></div><div><dt>Best day</dt><dd className={bestDay !== null && bestDay < 0 ? 'r' : 'g'}>{loading || loadError || bestDay === null ? '—' : fmtSigned(bestDay)}</dd></div></dl>
    </section>
    <div className="journal-view-tabs" role="tablist" aria-label="Results view" onKeyDown={event => {
      if (event.metaKey || event.ctrlKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 'calendar' : event.key === 'End' ? 'graph' : view === 'calendar' ? 'graph' : 'calendar'
      setView(next); event.currentTarget.querySelector<HTMLButtonElement>(`#journal-${next}-tab`)?.focus()
    }}>{(['calendar', 'graph'] as const).map(mode => <button type="button" role="tab" id={`journal-${mode}-tab`} key={mode} aria-controls="journal-results-panel" aria-selected={view === mode} tabIndex={view === mode ? 0 : -1} onClick={() => setView(mode)}>{mode === 'calendar' ? 'Calendar' : 'Graph'}</button>)}</div>
    <section className="journal-calendar" id="journal-results-panel" role="tabpanel" aria-labelledby={`journal-${view}-tab`} aria-busy={loading}>
      <div className="journal-toolbar"><div className="journal-month-nav">
        {!(view === 'graph' && statsRange === 'all') && <button type="button" className="journal-nav-btn" onClick={() => changePeriod(-1)} aria-label={view === 'graph' && statsRange === 'year' ? 'Previous year' : 'Previous month'}><ChevronLeft size={16} /></button>}
        <div className="journal-month-label">{view === 'graph' ? summaryLabel : monthLabel}</div>
        {!(view === 'graph' && statsRange === 'all') && <button type="button" className="journal-nav-btn" onClick={() => changePeriod(1)} aria-label={view === 'graph' && statsRange === 'year' ? 'Next year' : 'Next month'}><ChevronRight size={16} /></button>}
      </div>{!(view === 'graph' && statsRange === 'all') && <button type="button" className="journal-today-button" onClick={() => setViewDate(new Date())}>{view === 'graph' && statsRange === 'year' ? 'This year' : 'This month'}</button>}</div>
      {loading ? <p role="status">Loading your results…</p> : loadError ? <p role="status">Could not load account results. Reload to retry.</p> : !userId ? <p role="status">Sign in to see your account results.</p> : view === 'calendar' ? <>
        <div className="journal-weekdays">{WEEKDAY_LABELS.map(day => <div key={day}>{day}</div>)}</div>
        <div className="journal-grid">{cells.map((day, index) => {
          if (day === null) return <div className="journal-cell journal-cell-blank" key={`blank-${index}`} />
          const date = toISODate(new Date(year, month, day)), rows = tradesByDay.get(date) ?? [], amount = dailyTotals.get(date)
          return <button type="button" key={date} className={`journal-cell ${date === todayISO ? 'journal-cell-today' : ''} ${amount !== undefined ? amount < 0 ? 'journal-cell-loss' : amount > 0 ? 'journal-cell-win' : '' : rows.length ? 'journal-cell-pending' : ''}`} onClick={() => setEditingDate(date)} aria-label={`${date}: ${amount !== undefined ? fmtSigned(amount) : rows.length ? 'Open trades' : 'No trades'}. View trades`}><span className="journal-cell-day">{day}</span>{amount !== undefined ? <span className={`journal-cell-amt ${amount < 0 ? 'r' : 'g'}`}>{fmtSigned(amount)}</span> : rows.length > 0 ? <span className="journal-cell-amt journal-cell-open-label">Open</span> : null}{rows.length > 0 && <small className="journal-trade-count">{groupTrades(rows).length} trades</small>}</button>
        })}</div>
      </> : <div className="journal-graph"><h3>Cumulative P&L</h3><p className="journal-graph-description">{summaryLabel} · Realized account results · USD</p>
        {!graphPoints.length ? <div className="journal-graph-empty"><h4>No trades in this period</h4><p>Sync your account trades to see your P&L graph.</p></div> : <>
          <div className="journal-graph-with-total"><div className="journal-graph-chart" role="group" aria-label={`${summaryLabel} cumulative P&L in USD, ending at ${fmtSigned(total)}`}>
            <ResponsiveContainer width="100%" height="100%"><LineChart data={graphPoints} margin={{ top: 16, right: 12, bottom: 24, left: 0 }} accessibilityLayer>
              <CartesianGrid stroke="#ffffff0c" vertical={false} /><XAxis dataKey="position" type="number" domain={['dataMin', 'dataMax']} scale="time" minTickGap={24} tick={{ fill: '#a2a2b0', fontSize: 12 }} tickFormatter={formatDate} /><YAxis width={72} tick={{ fill: '#a2a2b0', fontSize: 12 }} tickFormatter={value => `$${Number(value).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })}`} /><ReferenceLine y={0} stroke="#727591" strokeDasharray="4 4" />
              <Tooltip contentStyle={{ background: '#18181f', border: '1px solid #494b70', borderRadius: 12 }} labelStyle={{ color: '#a2a2b0' }} labelFormatter={(_value, payload) => payload?.[0]?.payload?.label ?? 'Start of period'} formatter={value => [fmtSigned(Number(value)), 'Cumulative P&L']} />
              <Line key={rangeKey} className="journal-graph-line" type="linear" dataKey="cumulative" stroke={total < 0 ? '#ff3b5c' : '#00d17a'} strokeWidth={2.5} isAnimationActive={false} activeDot={false} dot={({ cx, cy, payload }) => {
                const point = payload as (typeof graphPoints)[number]
                if (point.tradeIndex === null) return <g key="start" />
                const trade = trades[point.tradeIndex]
                const open = () => setSelectedTrade(trade)
                const label = `${point.date}: ${point.label}, ${trade.realized_pnl === null ? 'Not realized yet' : fmtSigned(point.amount)}. View trade`
                return <g key={point.tradeIndex} className="journal-graph-point" role="button" tabIndex={0} aria-label={label} onClick={open} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() } }}><title>{label}</title><circle cx={cx} cy={cy} r={10} fill="transparent" /><circle cx={cx} cy={cy} r={4} fill="#111115" stroke={point.amount < 0 ? '#ff3b5c' : point.amount > 0 ? '#00d17a' : '#a2a2b0'} strokeWidth={2} /></g>
              }} />
            </LineChart></ResponsiveContainer>
          </div><div className="journal-graph-total"><span>Total P&L</span><strong className={total < 0 ? 'r' : 'g'}>{fmtSigned(total)}</strong></div></div>
          <details className="journal-graph-values"><summary>Daily results</summary><table><caption>{summaryLabel} results in USD</caption><thead><tr><th>Date</th><th>Daily P&L</th></tr></thead><tbody>{Array.from(dailyTotals).sort(([a], [b]) => a.localeCompare(b)).map(([date, amount]) => <tr key={date}><th scope="row">{date}</th><td>{fmtSigned(amount)}</td></tr>)}</tbody></table></details>
        </>}
      </div>}
      <button type="button" className="journal-share-mobile" disabled={!canShareMonth} onClick={openShare}><Share2 size={15} /> Share month</button>
    </section>
    {shareData && <JournalShareModal data={shareData} onClose={closeShare} />}
    <dialog ref={editorRef} className="journal-editor" aria-labelledby="journal-day-title" onCancel={() => setEditingDate(null)} onClose={() => setEditingDate(null)}>
      <div className="journal-editor-head"><h3 id="journal-day-title">{editingDate}</h3><button type="button" className="journal-editor-close" aria-label="Close day" onClick={() => setEditingDate(null)}><X size={16} /></button></div>
      {!editingDate || !tradesByDay.get(editingDate)?.length ? <p>No trades recorded for this day.</p> : groupTrades(tradesByDay.get(editingDate)!).map(group => <a className="journal-day-trade-row" key={`${group.key}-${group.occurred_at}`} href={`https://polymarket.us/event/${group.key}`} target="_blank" rel="noopener noreferrer"><div><strong>{group.title}</strong><span>{group.side} · {group.fills} fills</span></div><strong>{group.realized_pnl === null ? 'Open' : fmtSigned(group.realized_pnl)}</strong><ArrowUpRight size={15} /></a>)}
    </dialog>
    <dialog ref={tradeDialogRef} className="journal-editor" aria-labelledby="journal-trade-title" onCancel={() => setSelectedTrade(null)} onClose={() => setSelectedTrade(null)}>
      {selectedTrade && <><div className="journal-editor-head"><h3 id="journal-trade-title">{selectedTrade.title}</h3><button type="button" className="journal-editor-close" aria-label="Close trade" onClick={() => setSelectedTrade(null)}><X size={16} /></button></div><p className="connection-small">{new Date(selectedTrade.occurred_at).toLocaleString()}</p><dl className="journal-trade-details"><div><dt>Action</dt><dd>{selectedTrade.side}</dd></div><div><dt>Shares</dt><dd>{selectedTrade.size?.toLocaleString() ?? '—'}</dd></div><div><dt>Realized P&L</dt><dd>{selectedTrade.realized_pnl === null ? 'Not realized yet' : fmtSigned(selectedTrade.realized_pnl)}</dd></div></dl></>}
    </dialog>
  </div>
}
export default JournalCalendar
