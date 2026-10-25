import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { ChevronLeft, ChevronRight, X, Plus, MessageSquare, ArrowUpRight, Share2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmtSigned } from './helpers'
import { JournalShareModal, type JournalShareData } from './JournalShareCard'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { journalGraphPoints, journalEventPoints } from './journalGraph'
import './journal.css'

interface JournalEntry {
  entry_date: string
  amount: number
  note: string | null
}
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

// Daily reflections, manual results, and real trade history (see each day's Trades tab).
function JournalCalendar({ initialDay }: { initialDay?: string }) {
  const [userId, setUserId] = useState<string | null>(null)
  const [viewDate, setViewDate] = useState(() => initialDay ? new Date(initialDay + 'T00:00:00') : new Date())
  const [entries, setEntries] = useState<Map<string, JournalEntry>>(new Map())
  const [tradesByDay, setTradesByDay] = useState<Map<string, USTradeRow[]>>(new Map())
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'calendar' | 'graph'>('calendar')
  const [tradesLoading, setTradesLoading] = useState(true)
  const [tradesError, setTradesError] = useState(false)
  const [selectedTrade, setSelectedTrade] = useState<USTradeRow | null>(null)
  const tradeDialogRef = useRef<HTMLDialogElement>(null)
  const [editingDate, setEditingDate] = useState<string | null>(initialDay ?? null)
  const [dayTab, setDayTab] = useState<'trades' | 'manual'>('trades')
  const [editAmount, setEditAmount] = useState('')
  const [editNote, setEditNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [editorError, setEditorError] = useState('')
  const editorRef = useRef<HTMLDialogElement>(null)
  const [statsRange, setStatsRange] = useState<'month' | 'year' | 'all'>('month')
  const [rangeSummary, setRangeSummary] = useState<{ total: number; days: number; profitableDays: number; bestDay: number | null } | null>(null)
  const [rangeLoading, setRangeLoading] = useState(false)
  const [shareData, setShareData] = useState<JournalShareData | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) throw error
      setUserId(data.user?.id ?? null)
      if (!data.user) setLoading(false)
    }).catch(() => { setLoadError(true); setLoading(false) })
  }, [])

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const monthStart = toISODate(new Date(year, month, 1))
  const monthEnd = toISODate(new Date(year, month + 1, 0))

  useEffect(() => {
    if (!userId) return
    let active = true
    Promise.resolve(
      supabase.from('personal_pnl_entries').select('entry_date, amount, note')
        .gte('entry_date', monthStart).lte('entry_date', monthEnd)
    )
      .then(({ data, error }) => {
        if (error) throw error
        if (!active) return
        const m = new Map<string, JournalEntry>()
        for (const e of (data ?? []) as JournalEntry[]) m.set(e.entry_date, e)
        setEntries(m)
        if (initialDay) {
          setEditAmount(m.has(initialDay) ? String(m.get(initialDay)!.amount) : '')
          setEditNote(m.get(initialDay)?.note ?? '')
        }
      })
      .catch(() => { if (active) setLoadError(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [userId, monthStart, monthEnd, initialDay])

  useEffect(() => {
    if (!userId) return
    let active = true
    const nextMonthStart = toISODate(new Date(year, month + 1, 1))
    // US-only for now: international per-trade realized P&L isn't available
    // from Polymarket's Data API yet (see docs/polymarket-connections.md).
    Promise.resolve(
      supabase.from('polymarket_trades').select('asset, occurred_at, title, side, size, realized_pnl, order_id')
        .eq('venue', 'us').gte('occurred_at', `${monthStart}T00:00:00Z`).lt('occurred_at', `${nextMonthStart}T00:00:00Z`)
        .order('occurred_at', { ascending: false })
    )
      .then(({ data, error }) => {
        if (error) throw error
        if (!active) return
        const m = new Map<string, USTradeRow[]>()
        for (const row of (data ?? []) as USTradeRow[]) {
          const iso = toISODate(new Date(row.occurred_at))
          m.set(iso, [...(m.get(iso) ?? []), row])
        }
        setTradesByDay(m)
      })
      .catch(() => { if (active) setTradesError(true) })
      .finally(() => { if (active) setTradesLoading(false) })
    return () => { active = false }
  }, [userId, monthStart, monthEnd, year, month])

  // Year/all-time stats are a separate, wider fetch rather than reusing the
  // month-scoped entries/tradesByDay above — the calendar grid itself always
  // shows one month regardless of which range the summary header is set to.
  useEffect(() => {
    if (!userId || statsRange === 'month') return
    let active = true
    // Deferred so the effect body itself never calls setState synchronously —
    // matches the pattern used for the mount/backfill effects elsewhere in this app.
    const start = window.setTimeout(() => {
      if (!active) return
      setRangeLoading(true)
      const yearBounds = statsRange === 'year'
        ? { entryFrom: `${year}-01-01`, entryTo: `${year}-12-31`, tradeFrom: `${year}-01-01T00:00:00Z`, tradeTo: `${year + 1}-01-01T00:00:00Z` }
        : null
      let entryQuery = supabase.from('personal_pnl_entries').select('entry_date, amount')
      let tradeQuery = supabase.from('polymarket_trades').select('occurred_at, realized_pnl').eq('venue', 'us')
      if (yearBounds) {
        entryQuery = entryQuery.gte('entry_date', yearBounds.entryFrom).lte('entry_date', yearBounds.entryTo)
        tradeQuery = tradeQuery.gte('occurred_at', yearBounds.tradeFrom).lt('occurred_at', yearBounds.tradeTo)
      }
      Promise.all([entryQuery, tradeQuery])
        .then(([entriesRes, tradesRes]) => {
          if (entriesRes.error) throw entriesRes.error
          if (tradesRes.error) throw tradesRes.error
          if (!active) return
          const totals = new Map<string, number>()
          for (const e of (entriesRes.data ?? []) as { entry_date: string; amount: number }[]) {
            totals.set(e.entry_date, (totals.get(e.entry_date) ?? 0) + e.amount)
          }
          for (const t of (tradesRes.data ?? []) as { occurred_at: string; realized_pnl: number | null }[]) {
            if (t.realized_pnl == null) continue
            const iso = toISODate(new Date(t.occurred_at))
            totals.set(iso, (totals.get(iso) ?? 0) + t.realized_pnl)
          }
          const values = Array.from(totals.values())
          setRangeSummary({
            total: values.reduce((s, v) => s + v, 0),
            days: totals.size,
            profitableDays: values.filter(v => v > 0).length,
            bestDay: values.length ? Math.max(...values) : null,
          })
        })
        .catch(() => { if (active) setRangeSummary(null) })
        .finally(() => { if (active) setRangeLoading(false) })
    }, 0)
    return () => { active = false; clearTimeout(start) }
  }, [userId, statsRange, year])

  useEffect(() => {
    if (editingDate) editorRef.current?.showModal()
    else editorRef.current?.close()
  }, [editingDate])

  useEffect(() => {
    if (selectedTrade) tradeDialogRef.current?.showModal()
    else tradeDialogRef.current?.close()
  }, [selectedTrade])

  const changeMonth = (date: Date) => {
    if (date.getFullYear() === year && date.getMonth() === month) return
    setLoading(Boolean(userId))
    setLoadError(false)
    setEntries(new Map())
    setTradesByDay(new Map())
    setTradesLoading(Boolean(userId))
    setTradesError(false)
    setViewDate(date)
  }

  // Leading blanks (days from the previous month needed to fill the first
  // week) + every real day of the month — trailing blanks aren't needed
  // since a CSS grid just leaves the last row short instead of forcing a
  // full 6x7 rectangle.
  const cells = useMemo(() => {
    const firstWeekday = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const out: (number | null)[] = Array.from({ length: firstWeekday }, () => null)
    for (let d = 1; d <= daysInMonth; d++) out.push(d)
    return out
  }, [year, month])

  const todayISO = toISODate(new Date())
  const monthEntries = Array.from(entries.values()).sort((a, b) => b.entry_date.localeCompare(a.entry_date))
  // Days logged / profitable days / monthly P&L combine manual entries with
  // real trade P&L (currently US only — see the polymarket_trades fetch
  // above), summed per day rather than one source overriding the other.
  const realizedOn = (date: string) => (tradesByDay.get(date) ?? []).reduce((s, t) => s + (t.realized_pnl ?? 0), 0)
  const loggedDays = new Set([...entries.keys(), ...tradesByDay.keys()])
  // A position's entry and its settlement can land on different calendar
  // days. Grouping trades per-day (below) only sees whichever side fell on
  // that specific day, so an entry day can't tell on its own whether the
  // position is still open or was already closed elsewhere this month —
  // this cross-day index is what makes that distinguishable.
  const settledAssets = useMemo(() => {
    const out = new Set<string>()
    for (const rows of tradesByDay.values()) for (const row of rows) if (row.side === 'Settlement') out.add(row.asset)
    return out
  }, [tradesByDay])
  const combinedOn = (date: string) => (entries.get(date)?.amount ?? 0) + realizedOn(date)
  const monthTotal = Array.from(loggedDays).reduce((s, d) => s + combinedOn(d), 0)
  const profitableDays = Array.from(loggedDays).filter(d => combinedOn(d) > 0).length
  const bestDay = loggedDays.size ? Math.max(...Array.from(loggedDays).map(combinedOn)) : null
  const monthLabel = viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const dailyGraphPoints = journalGraphPoints(year, month, new Map(
    Array.from(loggedDays).filter(date => entries.has(date) || (tradesByDay.get(date) ?? []).some(trade => trade.realized_pnl != null)).map(date => [date, combinedOn(date)]),
  ))
  const graphTrades = Array.from(tradesByDay.values()).flat()
  const graphPoints = journalEventPoints(year, month, [
    ...graphTrades.map((trade, tradeIndex) => {
      const time = new Date(trade.occurred_at)
      return { date: toISODate(time), position: time.getDate() + (time.getHours() * 3600 + time.getMinutes() * 60 + time.getSeconds()) / 86400,
        amount: trade.realized_pnl ?? 0, label: trade.title, tradeIndex }
    }),
    ...Array.from(entries.values(), entry => ({ date: entry.entry_date, position: Number(entry.entry_date.slice(-2)) + .99999,
      amount: entry.amount, label: 'Manual entry', tradeIndex: null })),
  ])
  const summaryLabel = statsRange === 'month' ? monthLabel : statsRange === 'year' ? String(year) : 'All time'
  const summaryBusy = statsRange === 'month' ? (loading || loadError) : (rangeLoading || !rangeSummary)
  const summary = statsRange === 'month'
    ? { total: monthTotal, days: loggedDays.size, profitableDays, bestDay }
    : { total: rangeSummary?.total ?? 0, days: rangeSummary?.days ?? 0, profitableDays: rangeSummary?.profitableDays ?? 0, bestDay: rangeSummary?.bestDay ?? null }

  // Snapshot of the month on screen for the share image (JournalShareCard).
  // Taken once on open so the card doesn't redraw on every render.
  const openShare = () => {
    const days = new Map<number, number>()
    for (const iso of loggedDays) days.set(Number(iso.slice(-2)), combinedOn(iso))
    setShareData({ monthLabel, year, month, days, total: monthTotal, daysLogged: loggedDays.size, profitableDays, bestDay })
  }
  const closeShare = useCallback(() => setShareData(null), [])
  const canShareMonth = !loading && !loadError && loggedDays.size > 0

  // Today if this month is on screen, otherwise the 1st of the shown month.
  const logADay = () => openDay(year === new Date().getFullYear() && month === new Date().getMonth() ? new Date().getDate() : 1)

  const openDay = (day: number) => {
    const iso = toISODate(new Date(year, month, day))
    const existing = entries.get(iso)
    setEditingDate(iso)
    setDayTab((tradesByDay.get(iso)?.length ?? 0) > 0 ? 'trades' : 'manual')
    setEditAmount(existing ? String(existing.amount) : '')
    setEditNote(existing?.note ?? '')
    setEditorError('')
  }

  const closeEditor = () => {
    if (saving) return
    setEditingDate(null)
    setEditAmount('')
    setEditNote('')
  }

  const saveEntry = () => {
    if (!editingDate || !userId || (editAmount.trim() === '' && !editNote.trim())) return
    const amount = Number(editAmount)
    if (!Number.isFinite(amount)) return
    setSaving(true)
    setEditorError('')
    Promise.resolve(
      supabase.from('personal_pnl_entries')
        .upsert(
          { user_id: userId, entry_date: editingDate, amount, note: editNote.trim() || null },
          { onConflict: 'user_id,entry_date' }
        )
        .select('entry_date, amount, note').single()
    )
      .then(({ data, error }) => {
        if (error || !data) throw error
        setEntries(prev => new Map(prev).set(data.entry_date, data as JournalEntry))
        closeEditor()
      })
      .catch(() => setEditorError('Could not save this entry. Please try again.'))
      .finally(() => setSaving(false))
  }

  const deleteEntry = () => {
    if (!editingDate || !userId) return
    setSaving(true)
    setEditorError('')
    Promise.resolve(
      supabase.from('personal_pnl_entries').delete()
        .eq('user_id', userId).eq('entry_date', editingDate)
    )
      .then(({ error }) => {
        if (error) throw error
        setEntries(prev => {
          const next = new Map(prev)
          next.delete(editingDate)
          return next
        })
        closeEditor()
      })
      .catch(() => setEditorError('Could not delete this entry. Please try again.'))
      .finally(() => setSaving(false))
  }

  return (
    <div className="sig-page journal-page">
      <div className="app-section-header journal-header">
        <div>
          <h2 className="app-section-title">Your daily record</h2>
        </div>
        <div className="journal-header-actions">
          <button type="button" className="journal-add-button journal-share-button" disabled={!canShareMonth} onClick={openShare}><Share2 size={16} /> Share month</button>
          <button type="button" className="journal-add-button" disabled={!userId || loading || loadError} onClick={logADay}><Plus size={18} /> Log a day</button>
        </div>
      </div>

      <section className="journal-summary" aria-label={`${summaryLabel} summary`}>
        <div className="journal-summary-main">
          <div className="journal-range-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={statsRange === 'month'} onClick={() => setStatsRange('month')}>Month</button>
            <button type="button" role="tab" aria-selected={statsRange === 'year'} onClick={() => setStatsRange('year')}>Year</button>
            <button type="button" role="tab" aria-selected={statsRange === 'all'} onClick={() => setStatsRange('all')}>All time</button>
          </div>
          <strong className={summary.total > 0 ? 'g' : summary.total < 0 ? 'r' : ''}>{summaryBusy ? '—' : fmtSigned(summary.total)}</strong>
          <p>{summaryLabel}{(tradesByDay.size || (statsRange !== 'month' && summary.days)) ? ' · Manual entries + account P&L' : ''}</p>
        </div>
        <dl className="journal-summary-details">
          <div><dt>Days logged</dt><dd>{summaryBusy ? '—' : summary.days}</dd></div>
          <div><dt>Profitable days</dt><dd>{summaryBusy ? '—' : summary.profitableDays}</dd></div>
          <div><dt>Best day</dt><dd className={summary.bestDay !== null && summary.bestDay > 0 ? 'g' : summary.bestDay !== null && summary.bestDay < 0 ? 'r' : ''}>{summaryBusy || summary.bestDay === null ? '—' : fmtSigned(summary.bestDay)}</dd></div>
        </dl>
      </section>

      <div className="journal-view-tabs" role="tablist" aria-label="Results view" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const next = event.key === 'Home' ? 'calendar' : event.key === 'End' ? 'graph' : view === 'calendar' ? 'graph' : 'calendar'
        setView(next)
        event.currentTarget.querySelector<HTMLButtonElement>(`#journal-${next}-tab`)?.focus()
      }}>
        <button type="button" role="tab" id="journal-calendar-tab" aria-controls="journal-results-panel" aria-selected={view === 'calendar'} tabIndex={view === 'calendar' ? 0 : -1} onClick={() => setView('calendar')}>Calendar</button>
        <button type="button" role="tab" id="journal-graph-tab" aria-controls="journal-results-panel" aria-selected={view === 'graph'} tabIndex={view === 'graph' ? 0 : -1} onClick={() => setView('graph')}>Graph</button>
      </div>
      <section className="journal-calendar" id="journal-results-panel" role="tabpanel" aria-labelledby={`journal-${view}-tab`} aria-busy={loading || (view === 'graph' && Boolean(userId) && tradesLoading)}>
        <div className="journal-toolbar">
          <div className="journal-month-nav">
            <button type="button" className="journal-nav-btn" onClick={() => changeMonth(new Date(year, month - 1, 1))} aria-label="Previous month">
              <ChevronLeft size={16} />
            </button>
            <div className="journal-month-label">
              {monthLabel}
            </div>
            <button type="button" className="journal-nav-btn" onClick={() => changeMonth(new Date(year, month + 1, 1))} aria-label="Next month">
              <ChevronRight size={16} />
            </button>
          </div>
          <button type="button" className="journal-today-button" onClick={() => changeMonth(new Date())} disabled={year === new Date().getFullYear() && month === new Date().getMonth()}>This month</button>
          {/* Phone-only stand-in for the header's "Log a day" button, which
              is hidden there (along with the page's second title) so the
              P&L summary and the whole month fit on one screen. */}
          <button type="button" className="journal-toolbar-add" disabled={!userId || loading || loadError} onClick={logADay} aria-label="Log a day"><Plus size={16} /></button>
        </div>

        {view === 'calendar' ? <><div className="journal-weekdays">
          {WEEKDAY_LABELS.map(w => <div key={w}>{w}</div>)}
        </div>

        <div className="journal-grid">
          {cells.map((day, i) => {
            if (day === null) return <div key={`b${i}`} className="journal-cell journal-cell-blank" />
            const iso = toISODate(new Date(year, month, day))
            const entry = entries.get(iso)
            const hasData = loggedDays.has(iso)
            const combined = combinedOn(iso)
            // Grouped the same way the day editor groups trades, so a day's
            // color always reflects realized results only — an open position
            // with no result yet must not paint the cell green/red/gray.
            const dayGroups = groupTrades(tradesByDay.get(iso) ?? [])
            const openCount = dayGroups.filter(g => g.side === 'Entry' && !settledAssets.has(g.key)).length
            const hasRealized = Boolean(entry) || dayGroups.some(g => g.realized_pnl != null)
            const pendingOnly = openCount > 0 && !hasRealized
            const resultClass = pendingOnly ? 'journal-cell-pending' : hasData ? (combined > 0 ? 'journal-cell-win' : combined < 0 ? 'journal-cell-loss' : 'journal-cell-even') : ''
            const openLabel = openCount > 0 ? `${openCount} open position${openCount === 1 ? '' : 's'}` : ''
            const resultLabel = pendingOnly ? `${openLabel}. Edit entry` : hasData ? `${fmtSigned(combined)}${entry?.note ? ', has note' : ''}${!pendingOnly && openLabel ? `, ${openLabel}` : ''}. Edit entry` : 'Log profit or loss'
            return (
              <button
                type="button"
                key={iso}
                className={`journal-cell ${iso === todayISO ? 'journal-cell-today' : ''} ${resultClass} ${!pendingOnly && openCount > 0 ? 'journal-cell-has-open' : ''}`}
                onClick={() => openDay(day)}
                disabled={loading || loadError || !userId}
                aria-label={`${new Date(year, month, day).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}: ${resultLabel}`}
                aria-current={iso === todayISO ? 'date' : undefined}
              >
                <span className="journal-cell-day">{day}</span>
                {!pendingOnly && openCount > 0 && <span className="journal-cell-open-dot" aria-hidden="true" />}
                {pendingOnly
                  ? <span className="journal-cell-amt journal-cell-open-label">Open</span>
                  : hasData ? <><span className="journal-cell-amt">{fmtSigned(combined)}</span>{entry?.note && <MessageSquare className="journal-cell-note" size={12} aria-hidden="true" />}</> : <span className="journal-cell-add" aria-hidden="true">+</span>}
                {dayGroups.length > 0 && <small className={`journal-trade-count ${openCount > 0 ? 'journal-trade-count-open' : ''}`}>{dayGroups.length} {dayGroups.length === 1 ? 'trade' : 'trades'}{!pendingOnly && openCount > 0 ? ` · ${openCount} open` : ''}</small>}
              </button>
            )
          })}
        </div>

        </> : <div className="journal-graph">
          <h3>Cumulative P&L</h3>
          <p className="journal-graph-description">{monthLabel} · Realized results + manual entries · USD</p>
          {!userId && !loading ? <p role="status">Sign in to see your results.</p>
            : loading || tradesLoading ? <p role="status">Loading your results…</p>
              : loadError ? <p role="status">Could not load your results. Change months or reload to retry.</p>
                : <>
                  {tradesError && <p role="status">Account results are unavailable. Showing manual entries only.</p>}
                  {graphPoints.length === 0 ? <div className="journal-graph-empty"><h4>No results this month</h4><p>Log a result or sync settled trades to start your P&L graph.</p></div>
                    : <>
                      <div className="journal-graph-chart" role="group" aria-label={`${monthLabel} cumulative P&L in USD, ending at ${fmtSigned(graphPoints.at(-1)!.cumulative)}`}>
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={graphPoints} margin={{ top: 16, right: 16, bottom: 24, left: 0 }} accessibilityLayer>
                            <CartesianGrid stroke="#ffffff0c" vertical={false} />
                            <XAxis dataKey="position" type="number" domain={[0, Math.max(1, graphPoints.at(-1)!.position)]} allowDecimals={false} minTickGap={24} tick={{ fill: '#a2a2b0', fontSize: 12 }} tickFormatter={day => day === 0 ? 'Start' : String(day)} label={{ value: 'Day of month', position: 'bottom', fill: '#a2a2b0', fontSize: 12 }} />
                            <YAxis width={72} tick={{ fill: '#a2a2b0', fontSize: 12 }} tickFormatter={value => `$${Number(value).toLocaleString(undefined, { notation: 'compact', maximumFractionDigits: 1 })}`} />
                            <ReferenceLine y={0} stroke="#727591" strokeDasharray="4 4" />
                            <Tooltip contentStyle={{ background: '#18181f', border: '1px solid #494b70', borderRadius: 12 }} labelStyle={{ color: '#a2a2b0' }} labelFormatter={(_value, payload) => { const point = payload?.[0]?.payload; return point?.date ? `${point.date} · ${point.label}` : 'Start of month' }} formatter={value => [fmtSigned(Number(value)), 'Cumulative P&L']} />
                            <Line key={`${year}-${month}`} className="journal-graph-line" type="linear" dataKey="cumulative" stroke={graphPoints.at(-1)!.cumulative < 0 ? '#ff3b5c' : '#00d17a'} strokeWidth={2.5} dot={({ cx, cy, payload }) => {
                              const point = payload as (typeof graphPoints)[number]
                              if (!point.date) return <g key="start" />
                              const trade = point.tradeIndex === null ? null : graphTrades[point.tradeIndex]
                              const label = `${point.date}: ${point.label}, ${trade?.realized_pnl == null && trade ? 'No realized P&L' : fmtSigned(point.amount)}. View ${trade ? 'trade' : 'entry'}`
                              const open = () => trade ? setSelectedTrade(trade) : openDay(Number(point.date.slice(-2)))
                              return <g key={`${point.date}-${point.tradeIndex}`} className="journal-graph-point" role="button" tabIndex={0} aria-label={label} onClick={open} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open() } }}>
                                <title>{label}</title><circle cx={cx} cy={cy} r={10} fill="transparent" /><circle cx={cx} cy={cy} r={4} fill="#111115" stroke={point.amount < 0 ? '#ff3b5c' : point.amount > 0 ? '#00d17a' : '#a2a2b0'} strokeWidth={2} />
                              </g>
                            }} activeDot={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                      <details className="journal-graph-values"><summary>Daily results</summary><table><caption>{monthLabel} results in USD</caption><thead><tr><th scope="col">Day</th><th scope="col">Daily P&L</th><th scope="col">Cumulative P&L</th></tr></thead><tbody>{dailyGraphPoints.filter(point => point.day > 0).map(point => <tr key={point.day}><th scope="row">{point.day}</th><td>{fmtSigned(point.daily)}</td><td>{fmtSigned(point.cumulative)}</td></tr>)}</tbody></table></details>
                    </>}
                </>}
        </div>}

        {/* Phone-only: the header (with its Share month button) is hidden there. */}
        <button type="button" className="journal-share-mobile" disabled={!canShareMonth} onClick={openShare}><Share2 size={15} /> Share month</button>

        {view === 'calendar' && <p className={`journal-calendar-hint ${!loading && !loadError && userId ? 'journal-calendar-hint-idle' : ''}`} role="status">{loading ? 'Loading your entries…' : loadError ? 'Could not load your entries. Change months or reload to retry.' : !userId ? 'Sign in to keep your personal trading journal.' : 'Select a day to log your P&L or add a note.'}</p>}
      </section>

      {!loading && !loadError && <section className="journal-entries" aria-labelledby="journal-entries-title">
        <div className="journal-entries-heading"><h2 id="journal-entries-title">Your entries</h2><span>{monthLabel}</span></div>
        {monthEntries.length === 0 ? null : <div>{monthEntries.map(entry => <button className="journal-entry-row" type="button" key={entry.entry_date} onClick={() => openDay(Number(entry.entry_date.slice(-2)))}>
          <span className="journal-entry-date"><strong>{new Date(entry.entry_date + 'T00:00:00').getDate()}</strong><small>{new Date(entry.entry_date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' })}</small></span>
          <span className="journal-entry-note">{entry.note || 'No note added'}</span>
          <strong className={`journal-entry-amount ${entry.amount > 0 ? 'g' : entry.amount < 0 ? 'r' : ''}`}>{fmtSigned(entry.amount)}</strong><ArrowUpRight size={16} aria-hidden="true" />
        </button>)}</div>}
      </section>}

      {shareData && <JournalShareModal data={shareData} onClose={closeShare} />}

      <dialog className="journal-editor" ref={editorRef} aria-labelledby="journal-editor-title" onCancel={e => { e.preventDefault(); closeEditor() }} onClick={e => { if (e.target === e.currentTarget) closeEditor() }}>
        {editingDate && (() => {
          const dayGroups = groupTrades(tradesByDay.get(editingDate) ?? [])
          return <div>
            <div className="journal-editor-head">
              <div className="journal-editor-title" id="journal-editor-title">
                {new Date(editingDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              </div>
              <button type="button" className="journal-editor-close" onClick={closeEditor} disabled={saving} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="journal-day-tabs" role="tablist">
              <button type="button" role="tab" aria-selected={dayTab === 'trades'} onClick={() => setDayTab('trades')}>Trades{dayGroups.length ? ` (${dayGroups.length})` : ''}</button>
              <button type="button" role="tab" aria-selected={dayTab === 'manual'} onClick={() => setDayTab('manual')}>Manual entry{entries.has(editingDate) ? ' •' : ''}</button>
            </div>
            {dayTab === 'trades' ? <div className="journal-day-trades">
              {dayGroups.length === 0 ? <p className="connection-small">No trades recorded for this day.</p> : dayGroups.map(group => <a className="journal-day-trade-row" key={group.key} href={`https://polymarket.us/event/${group.key}`} target="_blank" rel="noopener noreferrer">
                <div><strong>{group.title}</strong><span>{group.side === 'Settlement' ? 'Settlement' : group.side === 'Position' ? `Closed${group.fills > 1 ? ` · ${group.fills} fills` : ''}` : `Entry${group.fills > 1 ? ` · ${group.fills} fills` : ''}${group.size != null ? ` · ${group.size.toLocaleString(undefined, { maximumFractionDigits: 2 })} shares` : ''}`} · {new Date(group.occurred_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
                <strong className={group.realized_pnl == null ? '' : group.realized_pnl > 0 ? 'g' : group.realized_pnl < 0 ? 'r' : ''}>{group.realized_pnl == null ? '—' : fmtSigned(group.realized_pnl)}</strong>
                <ArrowUpRight className="journal-day-trade-arrow" size={15} aria-hidden="true" />
              </a>)}
            </div> : <form onSubmit={e => { e.preventDefault(); saveEntry() }}>
              {dayGroups.length > 0 && <p className="connection-small">Your connected account already logged {fmtSigned(realizedOn(editingDate))} in realized P&amp;L for this day (see Trades). Anything entered below is added on top of that, not a replacement for it.</p>}
              <label className="journal-input-label" htmlFor="journal-amount">Manually logged profit / loss ($)</label>
              <input
                id="journal-amount"
                className="sig-watch-input"
                type="number"
                step="any"
                disabled={saving || loading || loadError}
                placeholder="e.g. 240 or -85"
                value={editAmount}
                onChange={e => setEditAmount(e.target.value)}
                autoFocus
              />
              <label className="journal-input-label" htmlFor="journal-note">Note (optional)</label>
              <p className="connection-small">For a reflection only, leave the amount blank. This records $0 in your manual results.</p>
              <textarea
                id="journal-note"
                disabled={saving || loading || loadError}
                className="sig-watch-input journal-note-input"
                placeholder="What happened today…"
                value={editNote}
                onChange={e => setEditNote(e.target.value)}
                rows={3}
              />
              {editorError && <p className="journal-editor-error" role="alert">{editorError}</p>}
              <div className="journal-editor-actions">
                {entries.has(editingDate) && (
                  <button type="button" className="sig-btn secondary journal-delete-button" onClick={deleteEntry} disabled={saving}>
                    Delete
                  </button>
                )}
                <button type="submit" className="sig-btn" disabled={saving || loading || loadError || (!editAmount.trim() && !editNote.trim())}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              </div>
            </form>}
          </div>
        })()}
      </dialog>
      <dialog ref={tradeDialogRef} className="journal-editor" aria-labelledby="journal-trade-title" onCancel={() => setSelectedTrade(null)} onClose={() => setSelectedTrade(null)}>
        {selectedTrade && <>
          <div className="journal-editor-head"><h3 id="journal-trade-title">{selectedTrade.title}</h3><button type="button" className="journal-editor-close" aria-label="Close trade" onClick={() => setSelectedTrade(null)}><X size={16} /></button></div>
          <p className="connection-small">{new Date(selectedTrade.occurred_at).toLocaleString()}</p>
          <dl className="journal-trade-details"><div><dt>Action</dt><dd>{selectedTrade.side}</dd></div><div><dt>Shares</dt><dd>{selectedTrade.size?.toLocaleString() ?? '—'}</dd></div><div><dt>Realized P&L</dt><dd className={(selectedTrade.realized_pnl ?? 0) < 0 ? 'r' : 'g'}>{selectedTrade.realized_pnl == null ? 'Not realized yet' : fmtSigned(selectedTrade.realized_pnl)}</dd></div></dl>
        </>}
      </dialog>
    </div>
  )
}

export default JournalCalendar
