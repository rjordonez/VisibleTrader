import { useState, useEffect, useMemo, useRef } from 'react'
import { ChevronLeft, ChevronRight, X, Plus, MessageSquare, ArrowUpRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Link } from 'react-router-dom'
import { dashboardPath } from '../lib/domains'
import { fmtSigned } from './helpers'
import './journal.css'

interface JournalEntry {
  entry_date: string
  amount: number
  note: string | null
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function toISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/* ── Journal ──
   A manually-entered daily P&L calendar — deliberately separate from
   every other page here, which shows tracked-wallet data. This is the
   user's own self-reported numbers, for their own personal record. */
function JournalPage() {
  const [userId, setUserId] = useState<string | null>(null)
  const [viewDate, setViewDate] = useState(() => new Date())
  const [entries, setEntries] = useState<Map<string, JournalEntry>>(new Map())
  const [loading, setLoading] = useState(true)
  const [editingDate, setEditingDate] = useState<string | null>(null)
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
      })
      .catch(() => { if (active) setLoadError(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [userId, monthStart, monthEnd])

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

  const monthTotal = Array.from(entries.values()).reduce((s, e) => s + e.amount, 0)
  const todayISO = toISODate(new Date())
  const monthEntries = Array.from(entries.values()).sort((a, b) => b.entry_date.localeCompare(a.entry_date))
  const profitableDays = monthEntries.filter(entry => entry.amount > 0).length
  const bestDay = monthEntries.length ? Math.max(...monthEntries.map(entry => entry.amount)) : null
  const monthLabel = viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  const openDay = (day: number) => {
    const iso = toISODate(new Date(year, month, day))
    const existing = entries.get(iso)
    setEditingDate(iso)
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
    if (!editingDate || !userId || editAmount.trim() === '') return
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
          <h1 className="app-section-title">Journal</h1>
          <p className="app-section-sub">Your trades. Your progress.</p>
        </div>
        <div className="journal-header-actions"><Link to={dashboardPath('/connections')} className="journal-add-button">Connect account</Link><button type="button" className="journal-add-button" disabled={!userId || loading || loadError} onClick={() => openDay(year === new Date().getFullYear() && month === new Date().getMonth() ? new Date().getDate() : 1)}><Plus size={18} /> Log a day</button></div>
      </div>

      <section className="journal-summary" aria-label={`${monthLabel} summary`}>
        <div className="journal-summary-main">
          <span>Monthly P&L</span>
          <strong className={monthTotal > 0 ? 'g' : monthTotal < 0 ? 'r' : ''}>{loading || loadError ? '—' : fmtSigned(monthTotal)}</strong>
          <p>{monthLabel} · Manually logged</p>
        </div>
        <dl className="journal-summary-details">
          <div><dt>Days logged</dt><dd>{loading || loadError ? '—' : entries.size}</dd></div>
          <div><dt>Profitable days</dt><dd>{loading || loadError ? '—' : profitableDays}</dd></div>
          <div><dt>Best day</dt><dd className={bestDay !== null && bestDay > 0 ? 'g' : bestDay !== null && bestDay < 0 ? 'r' : ''}>{loading || loadError || bestDay === null ? '—' : fmtSigned(bestDay)}</dd></div>
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
            return (
              <button
                type="button"
                key={iso}
                className={`journal-cell ${iso === todayISO ? 'journal-cell-today' : ''} ${entry ? (entry.amount > 0 ? 'journal-cell-win' : entry.amount < 0 ? 'journal-cell-loss' : 'journal-cell-even') : ''}`}
                onClick={() => openDay(day)}
                disabled={loading || loadError || !userId}
                aria-label={`${new Date(year, month, day).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}: ${entry ? `${fmtSigned(entry.amount)}${entry.note ? ', has note' : ''}. Edit entry` : 'Log profit or loss'}`}
                aria-current={iso === todayISO ? 'date' : undefined}
              >
                <span className="journal-cell-day">{day}</span>
                {entry ? <><span className="journal-cell-amt">{fmtSigned(entry.amount)}</span>{entry.note && <MessageSquare className="journal-cell-note" size={12} aria-hidden="true" />}</> : <span className="journal-cell-add" aria-hidden="true">+</span>}
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
        {editingDate && <form onSubmit={e => { e.preventDefault(); saveEntry() }}>
            <div className="journal-editor-head">
              <div className="journal-editor-title" id="journal-editor-title">
                {new Date(editingDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              </div>
              <button type="button" className="journal-editor-close" onClick={closeEditor} disabled={saving} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <label className="journal-input-label" htmlFor="journal-amount">Profit / loss ($)</label>
            <input
              id="journal-amount"
              className="sig-watch-input"
              type="number"
              step="any"
              required
              disabled={saving}
              placeholder="e.g. 240 or -85"
              value={editAmount}
              onChange={e => setEditAmount(e.target.value)}
              autoFocus
            />
            <label className="journal-input-label" htmlFor="journal-note">Note (optional)</label>
            <textarea
              id="journal-note"
              disabled={saving}
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
              <button type="submit" className="sig-btn" disabled={saving || editAmount.trim() === ''}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
        </form>}
      </dialog>
    </div>
  )
}

export default JournalPage
