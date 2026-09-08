import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Player } from '@lordicon/react'

// Lazy-loaded via HoverLord (pulls in lottie-web). Each icon's JSON is
// itself code-split and fetched on first mount by id; `fallback` shows
// until it lands. `playToken` bumps from the parent on hover.
const iconJson = import.meta.glob('./nav-icons/*.json', { import: 'default' }) as Record<
  string,
  () => Promise<{ fr?: number }>
>

// <1 slows every hover animation down (lottie plays at the composition's
// declared framerate, so a lower `fr` = same motion, more seconds).
const SPEED = 0.6

export default function LordIcon({ iconId, size = 20, color = '#d1d5db', playToken, fallback }: {
  iconId: string
  size?: number
  color?: string
  playToken: number
  fallback: ReactNode
}) {
  const [icon, setIcon] = useState<object | null>(null)
  const ref = useRef<Player>(null)

  useEffect(() => {
    let alive = true
    iconJson[`./nav-icons/${iconId}.json`]?.().then(data => {
      if (!alive) return
      const fr = data.fr ? Math.max(1, Math.round(data.fr * SPEED)) : undefined
      setIcon(fr ? { ...data, fr } : data)
    })
    return () => { alive = false }
  }, [iconId])

  useEffect(() => {
    if (playToken > 0 && icon) ref.current?.playFromBeginning()
  }, [playToken, icon])

  if (!icon) return <>{fallback}</>
  return <Player ref={ref} icon={icon} size={size} colorize={color} />
}
