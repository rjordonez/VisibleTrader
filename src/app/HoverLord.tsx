import { Suspense, lazy, type ReactNode } from 'react'
import { navIconIds } from './nav-icons'

const LordIcon = lazy(() => import('./LordIcon'))

// Renders an animated Lordicon for `iconId` that replays whenever
// `playToken` changes (the parent bumps it on hover, so the whole
// row/button is the trigger). Falls back to `fallback` when there's no
// icon for this id and while the chunk / JSON load.
export default function HoverLord({ iconId, size, color, playToken, fallback }: {
  iconId: string
  size?: number
  color?: string
  playToken: number
  fallback: ReactNode
}) {
  if (!navIconIds.has(iconId)) return <>{fallback}</>
  return (
    <Suspense fallback={fallback}>
      <LordIcon iconId={iconId} size={size} color={color} playToken={playToken} fallback={fallback} />
    </Suspense>
  )
}
