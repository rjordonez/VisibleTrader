import { useEffect, useRef, useState } from 'react'
import { BadgeCheck, X } from 'lucide-react'

// Illustrative only — same convention as WinnersPreview: fictional names,
// cities, and amounts, not a live feed of real Proof events. First name +
// last initial + a generic city, same de-identification pattern already
// used for the demo trader handles elsewhere on this page. Avatar reuses
// WinnersPreview's initial-on-gradient convention (.wp-avatar) instead of
// a generic trending-up glyph — a stock icon standing in for a specific
// person's win read as an obviously fake placeholder.
interface ProofWin {
  name: string
  location: string
  amount: number
  time: string
  bg: string
}

const items: ProofWin[] = [
  { name: 'Alex M.', location: 'New York, NY', amount: 1847, time: '10 minutes ago', bg: 'linear-gradient(135deg, #ca8a04, #facc15)' },
  { name: 'Priya S.', location: 'Austin, TX', amount: 3260, time: '4 minutes ago', bg: 'linear-gradient(135deg, #9333ea, #c084fc)' },
  { name: 'Marcus T.', location: 'Chicago, IL', amount: 940, time: '22 minutes ago', bg: 'linear-gradient(135deg, #0891b2, #22d3ee)' },
  { name: 'Dana R.', location: 'Miami, FL', amount: 5120, time: '2 minutes ago', bg: 'linear-gradient(135deg, #db2777, #f472b6)' },
  { name: 'Chris L.', location: 'Seattle, WA', amount: 2380, time: '17 minutes ago', bg: 'linear-gradient(135deg, #1e8f0d, #56ab4a)' },
]

const GAP_MS = 3200
const VISIBLE_MS = 7500
const FIRST_DELAY_MS = 2500

export default function ProofWidget() {
  const [index, setIndex] = useState(0)
  const [visible, setVisible] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const dismissedRef = useRef(false)

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    let cancelled = false

    const runCycle = (i: number, delay: number) => {
      const gapTimer = setTimeout(() => {
        if (cancelled || dismissedRef.current) return
        setIndex(i)
        setVisible(true)
        const hideTimer = setTimeout(() => {
          if (cancelled || dismissedRef.current) return
          setVisible(false)
          runCycle((i + 1) % items.length, GAP_MS)
        }, VISIBLE_MS)
        timers.push(hideTimer)
      }, delay)
      timers.push(gapTimer)
    }

    runCycle(0, FIRST_DELAY_MS)
    return () => { cancelled = true; timers.forEach(clearTimeout) }
  }, [])

  const dismiss = () => {
    dismissedRef.current = true
    setVisible(false)
    setDismissed(true)
  }

  if (dismissed) return null

  const item = items[index]

  return (
    <div className={`proof-widget ${visible ? 'show' : ''}`} aria-hidden="true">
      <button type="button" className="proof-close" onClick={dismiss} aria-label="Dismiss">
        <X size={13} strokeWidth={2.75} />
      </button>
      <div className="proof-card">
        <div className="proof-icon" style={{ background: item.bg }}>{item.name[0]}</div>
        <div className="proof-body">
          <span className="proof-name">{item.name} from {item.location}</span>
          <div className="proof-text">Won <strong>${item.amount.toLocaleString('en-US')}</strong> on their bet</div>
          <div className="proof-meta">
            {item.time} <span className="proof-dot">·</span> <BadgeCheck size={12} /> verified by Proof
          </div>
        </div>
      </div>
    </div>
  )
}
