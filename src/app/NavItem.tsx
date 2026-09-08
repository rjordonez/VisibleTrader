import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import HoverLord from './HoverLord'
import { navIconIds } from './nav-icons'

// How long the pointer must rest on a row before its icon animates —
// keeps a quick mouse pass-through from setting everything off.
const HOVER_DELAY_MS = 1000

// One sidebar nav row. If an animated Lordicon is registered for this id
// it plays once the pointer has rested on the row for HOVER_DELAY_MS;
// leaving early cancels it. Otherwise the plain Lucide icon renders.
export default function NavItem({ id, label, to, active, Icon }: {
  id: string
  label: string
  to: string
  active: boolean
  Icon: LucideIcon
}) {
  const [hoverTick, setHoverTick] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  const onEnter = () => {
    if (!navIconIds.has(id)) return
    timer.current = setTimeout(() => setHoverTick(t => t + 1), HOVER_DELAY_MS)
  }
  const onLeave = () => clearTimeout(timer.current)

  return (
    <Link
      to={to}
      title={label}
      className={`app-nav-item ${active ? 'active' : ''}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <span className="app-nav-lord" aria-hidden="true">
        <HoverLord
          iconId={id}
          size={18}
          color={active ? '#e3e5ff' : '#d1d5db'}
          playToken={hoverTick}
          fallback={<Icon size={17} />}
        />
      </span>
      <span className="app-nav-label">{label}</span>
    </Link>
  )
}
