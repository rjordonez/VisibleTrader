import { useEffect, useState } from 'react'
import { X } from 'lucide-react'

// Evergreen countdown — always counts down to the end of the current
// calendar day (local time), not a fixed one-time deadline. Resets every
// midnight rather than expiring for good, same "today" framing as the
// $1-first-week price on the pricing page.
function msUntilMidnight() {
  const now = new Date()
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 0, 0)
  return midnight.getTime() - now.getTime()
}

function formatDuration(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return [h, m, s].map(n => String(n).padStart(2, '0')).join(':')
}

export default function PromoBanner() {
  const [remaining, setRemaining] = useState(msUntilMidnight)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    const interval = setInterval(() => setRemaining(msUntilMidnight()), 1000)
    return () => clearInterval(interval)
  }, [])

  if (dismissed) return null

  return (
    <div className="promo-banner">
      <span>First week $1. Offer ends 11:59pm tonight: {formatDuration(remaining)}</span>
      <button type="button" className="promo-banner-close" onClick={() => setDismissed(true)} aria-label="Dismiss">
        <X size={16} />
      </button>
    </div>
  )
}
