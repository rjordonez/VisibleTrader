import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import ProfitCard from './ProfitCard'
import DashboardPreview from './DashboardPreview'
import DashboardPreviewMobile from './DashboardPreviewMobile'
import { supabase } from '../../lib/supabase'

// opportunity_wallets is a real, permanent, roster-trade-entry table — no
// production code ever deletes from it (confirmed live 2026-08-28: 595,142
// rows spanning back to 2026-07-24), so a count against it is a genuine,
// monotonically-growing total instead of a rolling/reset-prone window like
// the ticker table (2hr retention) or a per-process counter that resets on
// every deploy. The table itself is paywalled (its RLS policy, despite
// being named "public read", only allows rows through for an active/
// trialing subscriber via auth.uid() — confirmed live: the anon key gets
// zero rows), so the landing page calls tracked_trade_count() instead — a
// SECURITY DEFINER function (see its migration) that returns only the
// single COUNT, never any row data, keeping the paywall intact.
//
// The display ticks up every second for a "live" feel, but that tick is a
// small bounded jitter (+0-3), never a fabricated jump — real polling every
// 5s always wins (Math.max), so the shown number can never drift meaningfully
// from the true count. First paint reveals 0 -> the real value once.
function useLiveTradeCounter(pollMs = 5000, revealMs = 1200) {
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
function RollingDigit({ digit }: { digit: number }) {
  return (
    <span className="tick-digit">
      <span className="tick-digit-strip" style={{ transform: `translateY(-${digit}em)` }}>
        {Array.from({ length: 10 }, (_, i) => <span key={i}>{i}</span>)}
      </span>
    </span>
  )
}

function RollingNumber({ value }: { value: number }) {
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

export default function Hero() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const tradeCount = useLiveTradeCounter()

  // Capturing the lead is best-effort — a failed insert (network blip, RLS
  // hiccup) shouldn't trap someone who's ready to sign up on the landing
  // page. Email carries through as a query param so the signup form only
  // asks for a password, not the email again.
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    await supabase.from('leads').insert({ email, source: 'hero_form' })
    navigate(`/signup?email=${encodeURIComponent(email)}`)
  }

  return (
    <section className="hero">

      {/* ── Two-column top ── */}
      <div className="hero-cols">
        {/* Left */}
        <div className="hero-copy">
          {/* Trust row (top) */}
          <div className="hero-trust-row" style={{ marginBottom: '1.25rem' }}>
            <p className="hero-trust-text">
              {tradeCount === 0 ? (
                <>Built on <strong>100% on-chain</strong> Polymarket trade data</>
              ) : (
                <><strong><RollingNumber value={tradeCount} /></strong> real trades tracked, on-chain</>
              )}
            </p>
          </div>

          <h1>
            See what<br />
            <span>proven winners</span><br />
            are trading, live.
          </h1>

          <p className="hero-sub">
            VisibleTrader watches the top-performing wallets on Polymarket in real time and
            surfaces what they're buying, the moment they buy it.
          </p>

          <form className="hero-form" onSubmit={submit}>
            <div className="hero-form-inner">
              <input
                type="email"
                placeholder="Your email..."
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
              />
              <button type="submit" className="btn-primary" disabled={submitting}>
                {submitting ? 'One sec…' : 'Get started free'}
              </button>
            </div>
          </form>
        </div>

        {/* Right: live signal preview card */}
        <div className="hero-card-wrap">
          <ProfitCard />
        </div>
      </div>

      {/* ── Dashboard preview ── */}
      <DashboardPreview />
      <DashboardPreviewMobile />

      {/* ── Trust bar ── */}
      <div className="hero-trust-bar">
        {[
          '7-Day Free Trial',
          'Real Wallets, Real Trades',
          'Polymarket',
          'Sub-Second Signal Latency',
        ].map(item => (
          <div key={item} className="hero-trust-item">
            <span className="hero-trust-check">✓</span>
            {item}
          </div>
        ))}
      </div>
    </section>
  )
}
