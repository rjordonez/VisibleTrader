import { useState, useEffect, useRef } from 'react'
import { supabase } from './supabase'

// opportunity_wallets is a real, permanent, roster-trade-entry table — no
// production code ever deletes from it (confirmed live 2026-08-28: 595,142
// rows spanning back to 2026-07-24), so a count against it is a genuine,
// monotonically-growing total instead of a rolling/reset-prone window like
// the ticker table (2hr retention) or a per-process counter that resets on
// every deploy. The table itself is paywalled (its RLS policy, despite
// being named "public read", only allows rows through for an active/
// trialing subscriber via auth.uid() — confirmed live: the anon key gets
// zero rows), so callers use tracked_trade_count() instead — a
// SECURITY DEFINER function (see its migration) that returns only the
// single COUNT, never any row data, keeping the paywall intact. Shared by
// the landing page's Hero and OnboardingPage (which also runs before a
// user has subscribed) rather than duplicated.
//
// The display ticks up every second for a "live" feel, but that tick is a
// small bounded jitter (+0-3), never a fabricated jump — real polling every
// 5s always wins (Math.max), so the shown number can never drift meaningfully
// from the true count. First paint reveals 0 -> the real value once.
export function useLiveTradeCounter(pollMs = 5000, revealMs = 1200) {
  const [display, setDisplay] = useState(0)
  const [real, setReal] = useState<number | null>(null)
  const revealedRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    const poll = () => {
      Promise.resolve(supabase.rpc('tracked_trade_count'))
        .then(({ data }) => { if (!cancelled && data != null) setReal(Number(data)) })
        .catch(() => {})
    }
    poll()
    const interval = setInterval(poll, pollMs)
    return () => { cancelled = true; clearInterval(interval) }
  }, [pollMs])

  useEffect(() => {
    if (real == null) return
    if (!revealedRef.current) {
      revealedRef.current = true
      const target = real
      const start = performance.now()
      let raf: number
      const tick = (now: number) => {
        const t = Math.min(1, (now - start) / revealMs)
        setDisplay(Math.round(target * (1 - Math.pow(1 - t, 3)))) // ease-out cubic
        if (t < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
      return () => cancelAnimationFrame(raf)
    }
    setDisplay(d => Math.max(d, real)) // ground truth always wins, never jumps backward
  }, [real, revealMs])

  useEffect(() => {
    const t = setInterval(() => {
      if (!revealedRef.current) return
      setDisplay(d => d + Math.floor(Math.random() * 4)) // +0-3, visual-only
    }, 1000)
    return () => clearInterval(t)
  }, [])

  return display
}

// Odometer digit: a fixed 1em-tall window onto a vertical strip of 0-9 —
// translating the strip (with a CSS transition, see .tick-digit-strip)
// slides the old digit out and the new one in, instead of the text
// swapping outright.
export function RollingDigit({ digit }: { digit: number }) {
  return (
    <span className="tick-digit">
      <span className="tick-digit-strip" style={{ transform: `translateY(-${digit}em)` }}>
        {Array.from({ length: 10 }, (_, i) => <span key={i}>{i}</span>)}
      </span>
    </span>
  )
}

export function RollingNumber({ value }: { value: number }) {
  return (
    <span className="tick-num">
      {value.toLocaleString('en-US').split('').map((ch, i) =>
        /\d/.test(ch)
          ? <RollingDigit key={i} digit={Number(ch)} />
          : <span key={i} className="tick-comma">{ch}</span>
      )}
    </span>
  )
}
