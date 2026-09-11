import { useState, useEffect, useMemo, useRef } from 'react'
import { ChevronLeft, ChevronRight, X, Plus, MessageSquare, ArrowUpRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmtSigned } from './helpers'
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
      .catch(() => { /* Real trade P&L is additive; a failed fetch just falls back to manual-only stats. */ })
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

  const changeMonth = (date: Date) => {
    if (date.getFullYear() === year && date.getMonth() === month) return
    setLoading(Boolean(userId))
    setLoadError(false)
    setEntries(new Map())
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
  const combinedOn = (date: string) => (entries.get(date)?.amount ?? 0) + realizedOn(date)
  const monthTotal = Array.from(loggedDays).reduce((s, d) => s + combinedOn(d), 0)
  const profitableDays = Array.from(loggedDays).filter(d => combinedOn(d) > 0).length
  const bestDay = loggedDays.size ? Math.max(...Array.from(loggedDays).map(combinedOn)) : null
  const monthLabel = viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  const summaryLabel = statsRange === 'month' ? monthLabel : statsRange === 'year' ? String(year) : 'All time'
  const summaryBusy = statsRange === 'month' ? (loading || loadError) : (rangeLoading || !rangeSummary)
  const summary = statsRange === 'month'
    ? { total: monthTotal, days: loggedDays.size, profitableDays, bestDay }
    : { total: rangeSummary?.total ?? 0, days: rangeSummary?.days ?? 0, profitableDays: rangeSummary?.profitableDays ?? 0, bestDay: rangeSummary?.bestDay ?? null }

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
          <p className="app-section-sub">Review your activity and capture what you learned.</p>
        </div>
        <button type="button" className="journal-add-button" disabled={!userId || loading || loadError} onClick={() => openDay(year === new Date().getFullYear() && month === new Date().getMonth() ? new Date().getDate() : 1)}><Plus size={18} /> Log a day</button>
      </div>

      <section className="journal-summary" aria-label={`${summaryLabel} summary`}>
        <div className="journal-summary-main">
          <div className="journal-range-tabs" role="tablist">
            <button type="button" role="tab" aria-selected={statsRange === 'month'} onClick={() => setStatsRange('month')}>Month</button>
            <button type="button" role="tab" aria-selected={statsRange === 'year'} onClick={() => setStatsRange('year')}>Year</button>
            <button type="button" role="tab" aria-selected={statsRange === 'all'} onClick={() => setStatsRange('all')}>All time</button>
          </div>
          <strong className={summary.total > 0 ? 'g' : summary.total < 0 ? 'r' : ''}>{summaryBusy ? '—' : fmtSigned(summary.total)}</strong>
          <p>{summaryLabel} · {tradesByDay.size || (statsRange !== 'month' && summary.days) ? 'Manual entries + account P&L' : 'Manually logged'}</p>
        </div>
        <dl className="journal-summary-details">
          <div><dt>Days logged</dt><dd>{summaryBusy ? '—' : summary.days}</dd></div>
          <div><dt>Profitable days</dt><dd>{summaryBusy ? '—' : summary.profitableDays}</dd></div>
          <div><dt>Best day</dt><dd className={summary.bestDay !== null && summary.bestDay > 0 ? 'g' : summary.bestDay !== null && summary.bestDay < 0 ? 'r' : ''}>{summaryBusy || summary.bestDay === null ? '—' : fmtSigned(summary.bestDay)}</dd></div>
        </dl>
      </section>

      <section className="journal-calendar" aria-label="Daily P&L calendar" aria-busy={loading}>
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
        </div>

        <div className="journal-weekdays">
          {WEEKDAY_LABELS.map(w => <div key={w}>{w}</div>)}
        </div>

        <div className="journal-grid">
          {cells.map((day, i) => {
            if (day === null) return <div key={`b${i}`} className="journal-cell journal-cell-blank" />
            const iso = toISODate(new Date(year, month, day))
            const entry = entries.get(iso)
            const hasData = loggedDays.has(iso)
            const combined = combinedOn(iso)
            return (
              <button
                type="button"
                key={iso}
                className={`journal-cell ${iso === todayISO ? 'journal-cell-today' : ''} ${hasData ? (combined > 0 ? 'journal-cell-win' : combined < 0 ? 'journal-cell-loss' : 'journal-cell-even') : ''}`}
                onClick={() => openDay(day)}
                disabled={loading || loadError || !userId}
                aria-label={`${new Date(year, month, day).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}: ${hasData ? `${fmtSigned(combined)}${entry?.note ? ', has note' : ''}. Edit entry` : 'Log profit or loss'}`}
                aria-current={iso === todayISO ? 'date' : undefined}
              >
                <span className="journal-cell-day">{day}</span>
                {hasData ? <><span className="journal-cell-amt">{fmtSigned(combined)}</span>{entry?.note && <MessageSquare className="journal-cell-note" size={12} aria-hidden="true" />}</> : <span className="journal-cell-add" aria-hidden="true">+</span>}
                {(() => {
                  const count = groupTrades(tradesByDay.get(iso) ?? []).length
                  return count > 0 && <small className="journal-trade-count">{count} {count === 1 ? 'trade' : 'trades'}</small>
                })()}
              </button>
            )
          })}
        </div>

        <p className="journal-calendar-hint" role="status">{loading ? 'Loading your entries…' : loadError ? 'Could not load your entries. Change months or reload to retry.' : !userId ? 'Sign in to keep your personal trading journal.' : 'Select a day to log your P&L or add a note.'}</p>
      </section>

      {!loading && !loadError && <section className="journal-entries" aria-labelledby="journal-entries-title">
        <div className="journal-entries-heading"><h2 id="journal-entries-title">Your entries</h2><span>{monthLabel}</span></div>
        {monthEntries.length === 0 ? <div className="journal-empty"><h3>A little reflection goes a long way.</h3><p>Log a day's result and what you learned. Your entries will appear here.</p></div> : <div>{monthEntries.map(entry => <button className="journal-entry-row" type="button" key={entry.entry_date} onClick={() => openDay(Number(entry.entry_date.slice(-2)))}>
          <span className="journal-entry-date"><strong>{new Date(entry.entry_date + 'T00:00:00').getDate()}</strong><small>{new Date(entry.entry_date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' })}</small></span>
          <span className="journal-entry-note">{entry.note || 'No note added'}</span>
          <strong className={`journal-entry-amount ${entry.amount > 0 ? 'g' : entry.amount < 0 ? 'r' : ''}`}>{fmtSigned(entry.amount)}</strong><ArrowUpRight size={16} aria-hidden="true" />
        </button>)}</div>}
      </section>}

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
              {dayGroups.length === 0 ? <p className="connection-small">No trades recorded for this day.</p> : dayGroups.map(group => <div className="journal-day-trade-row" key={group.key}>
                <div><strong>{group.title}</strong><span>{group.side === 'Settlement' ? 'Settlement' : group.side === 'Position' ? `Closed${group.fills > 1 ? ` · ${group.fills} fills` : ''}` : `Entry${group.fills > 1 ? ` · ${group.fills} fills` : ''}${group.size != null ? ` · ${group.size.toLocaleString(undefined, { maximumFractionDigits: 2 })} shares` : ''}`} · {new Date(group.occurred_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
                <strong className={group.realized_pnl == null ? '' : group.realized_pnl > 0 ? 'g' : group.realized_pnl < 0 ? 'r' : ''}>{group.realized_pnl == null ? '—' : fmtSigned(group.realized_pnl)}</strong>
              </div>)}
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
    </div>
  )
}

export default JournalCalendar
