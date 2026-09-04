import { useState, useEffect, useMemo } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { fmtSigned } from './helpers'

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

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
  }, [])

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const monthStart = toISODate(new Date(year, month, 1))
  const monthEnd = toISODate(new Date(year, month + 1, 0))

  useEffect(() => {
    if (!userId) return
    setLoading(true)
    Promise.resolve(
      supabase.from('personal_pnl_entries').select('entry_date, amount, note')
        .gte('entry_date', monthStart).lte('entry_date', monthEnd)
    )
      .then(({ data }) => {
        const m = new Map<string, JournalEntry>()
        for (const e of (data ?? []) as JournalEntry[]) m.set(e.entry_date, e)
        setEntries(m)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, monthStart, monthEnd])

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

  const openDay = (day: number) => {
    const iso = toISODate(new Date(year, month, day))
    const existing = entries.get(iso)
    setEditingDate(iso)
    setEditAmount(existing ? String(existing.amount) : '')
    setEditNote(existing?.note ?? '')
  }

  const closeEditor = () => {
    setEditingDate(null)
    setEditAmount('')
    setEditNote('')
  }

  const saveEntry = () => {
    if (!editingDate || !userId) return
    const amount = Number(editAmount)
    if (!Number.isFinite(amount)) return
    setSaving(true)
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
      .catch(() => {})
      .finally(() => setSaving(false))
  }

  const deleteEntry = () => {
    if (!editingDate || !userId) return
    setSaving(true)
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
      .catch(() => {})
      .finally(() => setSaving(false))
  }

  return (
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Journal</h1>
          <p className="app-section-sub">Your own daily wins and losses — not tracked-wallet data, just your record.</p>
        </div>
      </div>

      <div className="sig-panel" style={{ maxWidth: 780 }}>
        <div className="journal-toolbar">
          <div className="journal-month-nav">
            <button type="button" className="journal-nav-btn" onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() - 1, 1))} aria-label="Previous month">
              <ChevronLeft size={16} />
            </button>
            <div className="journal-month-label">
              {viewDate.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
            </div>
            <button type="button" className="journal-nav-btn" onClick={() => setViewDate(d => new Date(d.getFullYear(), d.getMonth() + 1, 1))} aria-label="Next month">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className={`journal-month-total ${monthTotal >= 0 ? 'g' : 'r'}`}>
            {fmtSigned(monthTotal)} this month
          </div>
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
                className={`journal-cell ${iso === todayISO ? 'journal-cell-today' : ''} ${entry ? (entry.amount >= 0 ? 'journal-cell-win' : 'journal-cell-loss') : ''}`}
                onClick={() => openDay(day)}
              >
                <span className="journal-cell-day">{day}</span>
                {entry && <span className="journal-cell-amt">{fmtSigned(entry.amount)}</span>}
              </button>
            )
          })}
        </div>

        {loading && <div className="sig-empty">Loading…</div>}
      </div>

      {editingDate && (
        <div className="journal-editor-backdrop" onClick={closeEditor}>
          <div className="journal-editor" onClick={e => e.stopPropagation()}>
            <div className="journal-editor-head">
              <div className="journal-editor-title">
                {new Date(editingDate + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
              </div>
              <button type="button" className="journal-editor-close" onClick={closeEditor} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="sig-filter-label" style={{ marginBottom: 6 }}>Profit / loss</div>
            <input
              className="sig-watch-input"
              type="number"
              placeholder="e.g. 240 or -85"
              value={editAmount}
              onChange={e => setEditAmount(e.target.value)}
              autoFocus
            />
            <div className="sig-filter-label" style={{ margin: '14px 0 6px' }}>Note (optional)</div>
            <textarea
              className="sig-watch-input journal-note-input"
              placeholder="What happened today…"
              value={editNote}
              onChange={e => setEditNote(e.target.value)}
              rows={3}
            />
            <div className="journal-editor-actions">
              {entries.has(editingDate) && (
                <button type="button" className="sig-btn secondary" style={{ borderColor: '#f87171', color: '#f87171' }} onClick={deleteEntry} disabled={saving}>
                  Delete
                </button>
              )}
              <button type="button" className="sig-btn" onClick={saveEntry} disabled={saving || editAmount.trim() === ''}>
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default JournalPage
