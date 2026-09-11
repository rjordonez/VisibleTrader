import { useState, useEffect, useMemo, useRef } from 'react'
import { ChevronLeft, ChevronRight, X, Plus, MessageSquare, ArrowUpRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Activity } from './connections/api'
import { money } from './connections/api'
import { fmtSigned } from './helpers'
import './journal.css'

interface JournalEntry {
  entry_date: string
  amount: number
  note: string | null
}
interface USTradeRow {
  occurred_at: string
  title: string
  side: string
  size: number | null
  realized_pnl: number | null
}
interface TradeGroup {
  key: string
  title: string
  side: string
  occurred_at: string
  fills: number
  size: number | null
  realized_pnl: number | null
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function toISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// A single order placed against a thin order book can fill in many pieces —
// each a genuine, separate activity row from Polymarket, but not something
// a person thinks of as a separate trade. Fills of one order share the same
// market and the exact same timestamp (the order's own createTime), so that
// pair is a reliable, already-available grouping key — no new data needed.
// Settlement rows are real one-per-event P&L and are never grouped.
function groupTrades(rows: USTradeRow[]): TradeGroup[] {
  const groups: TradeGroup[] = []
  const index = new Map<string, TradeGroup>()
  for (const row of rows) {
    if (row.side !== 'Trade') {
      groups.push({ key: `${row.occurred_at}-${groups.length}`, title: row.title, side: row.side, occurred_at: row.occurred_at, fills: 1, size: row.size, realized_pnl: row.realized_pnl })
      continue
    }
    const key = `${row.occurred_at}|${row.title}`
    const existing = index.get(key)
    if (existing) { existing.fills += 1; existing.size = existing.size == null && row.size == null ? null : (existing.size ?? 0) + (row.size ?? 0) }
    else {
      const group: TradeGroup = { key, title: row.title, side: row.side, occurred_at: row.occurred_at, fills: 1, size: row.size, realized_pnl: null }
      index.set(key, group)
      groups.push(group)
    }
  }
  return groups
}

// Daily reflections and manual results, with recent account activity as context.
function JournalCalendar({ activity = [], initialDay }: { activity?: (Activity & { venue: string })[]; initialDay?: string }) {
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
      supabase.from('polymarket_trades').select('occurred_at, title, side, size, realized_pnl')
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
  const monthActivity = activity
    .filter(trade => trade.timestamp != null && new Date(trade.timestamp * 1000).getFullYear() === year && new Date(trade.timestamp * 1000).getMonth() === month)
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
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

      <section className="journal-summary" aria-label={`${monthLabel} summary`}>
        <div className="journal-summary-main">
          <span>Monthly P&L</span>
          <strong className={monthTotal > 0 ? 'g' : monthTotal < 0 ? 'r' : ''}>{loading || loadError ? '—' : fmtSigned(monthTotal)}</strong>
          <p>{monthLabel} · {tradesByDay.size ? 'Manual entries + account P&L' : 'Manually logged'}</p>
        </div>
        <dl className="journal-summary-details">
          <div><dt>Days logged</dt><dd>{loading || loadError ? '—' : loggedDays.size}</dd></div>
          <div><dt>Profitable days</dt><dd>{loading || loadError ? '—' : profitableDays}</dd></div>
          <div><dt>Best day</dt><dd className={bestDay !== null && bestDay > 0 ? 'g' : bestDay !== null && bestDay < 0 ? 'r' : ''}>{loading || loadError || bestDay === null ? '—' : fmtSigned(bestDay)}</dd></div>
        </dl>
      </section>

      <section className="journal-activity" aria-labelledby="journal-activity-title">
        <div className="journal-entries-heading"><h2 id="journal-activity-title">Account activity</h2><span>{monthLabel}</span></div>
        {monthActivity.length === 0 ? <div className="journal-empty"><p>No imported trades were fetched for this month.</p></div> : <div className="journal-activity-list">{monthActivity.map((trade, index) => <button type="button" className="journal-activity-row" key={`${trade.venue}-${trade.transaction_hash}-${index}`} onClick={() => openDay(new Date((trade.timestamp ?? 0) * 1000).getDate())}>
          <span className="journal-activity-date"><strong>{new Date((trade.timestamp ?? 0) * 1000).getDate()}</strong><small>{new Date((trade.timestamp ?? 0) * 1000).toLocaleDateString(undefined, { weekday: 'short' })}</small></span>
          <span className="journal-activity-detail"><strong>{trade.title}</strong><small>{trade.venue} · {trade.side} · {trade.timestamp == null ? 'Time unavailable' : new Date(trade.timestamp * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</small></span>
          <span className="journal-activity-amount">{trade.pnl != null ? `P&L ${fmtSigned(trade.pnl)}` : money(trade.amount)}</span><ArrowUpRight size={15} aria-hidden="true" />
        </button>)}</div>}
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
                <div><strong>{group.title}</strong><span>{group.side === 'Settlement' ? 'Settlement' : `Entry${group.fills > 1 ? ` · ${group.fills} fills` : ''}${group.size != null ? ` · ${group.size.toLocaleString(undefined, { maximumFractionDigits: 2 })} shares` : ''}`} · {new Date(group.occurred_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></div>
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
