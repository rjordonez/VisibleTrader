import { useState, useEffect, useRef } from 'react'

// Shows the real value immediately (no zero, no reveal animation) — then,
// whenever a later poll brings back a changed target, eases from the old
// real value to the new one instead of snapping. Never invents a value:
// every frame is a point between two real numbers, and it always lands
// exactly on `target`. Split out from RollingCounter.tsx (a components
// file) so mixing a hook export in there doesn't trip react-refresh.
export function useCountUp(target: number, ms = 900) {
  const [n, setN] = useState(target)
  const fromRef = useRef(target)
  const mountedRef = useRef(false)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      fromRef.current = target
      setN(target)
      return
    }
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      fromRef.current = target
      setN(target)
      return
    }
    const from = fromRef.current
    const begin = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - begin) / ms)
      const v = from + (target - from) * (1 - Math.pow(1 - t, 3)) // ease-out cubic
      fromRef.current = v
      setN(v)
      if (t < 1) raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return n
}
