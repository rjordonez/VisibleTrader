import { useState, useEffect, useRef } from 'react'
import { supabase } from './lib/supabase'
import posthog from './lib/posthog'
import { useLiveTradeCounter, RollingNumber } from './lib/RollingCounter'
import { getReferralCode } from './lib/domains'
import { fmtAbbrev } from './app/helpers'
import './app/app.css'

// Eases a number from its current shown value up to `target` over ~1.2s
// (ease-out cubic, same curve as useLiveTradeCounter's reveal). Feeding the
// intermediate values to <RollingNumber> makes the profit figure visibly
// spin up when the slide appears instead of just being there.
function useCountUp(target: number, ms = 1200) {
  const [n, setN] = useState(0)
  const fromRef = useRef(0)
  useEffect(() => {
    if (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches) {
      fromRef.current = target
      setN(target)
      return
    }
    const from = fromRef.current
    const start = performance.now()
    let raf = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / ms)
      const v = Math.round(from + (target - from) * (1 - Math.pow(1 - t, 3)))
      fromRef.current = v
      setN(v)
      if (t < 1) raf = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return n
}

// Shown by ProtectedRoute for a signed-in user who hasn't been through
// this yet (user_metadata.onboarding_completed unset) — before the
// subscription check, so it applies regardless of subscription status.
// Lives next to ProtectedRoute, same reasoning: a gate page ProtectedRoute
// renders in place of the real app, not a page of the app itself (which
// lives under src/app instead).
//
// The first two questions match the marketing site's /estimate quiz
// (EstimatePage.tsx) — duplicated rather than imported since that page's
// quiz-progression state isn't meant to be reused as a shared component.
// The third (bet_size) is onboarding-only.
const questions = [
  {
    key: 'interest',
    q: 'Which markets do you care about most?',
    options: ['Sports', 'Politics', 'Crypto', 'Everything'],
  },
  {
    key: 'experience',
    q: 'How familiar are you with Polymarket?',
    options: ['Brand new', "I've placed a few bets", 'Active trader', 'I trade daily'],
  },
  {
    key: 'bet_size',
    q: "What's your typical bet size?",
    options: ['Under $50', '$50 to $500', '$500 to $5,000', '$5,000+'],
  },
  {
    key: 'trade_frequency',
    q: 'How often do you trade?',
    options: ['A few times a month', 'A few times a week', 'About once a day', 'Multiple times a day'],
  },
]

// Representative per-trade dollar amount and trades-per-week for each
// answer above — used to turn "you could have made" into a number in the
// user's own terms on the signal slide.
const BET_SIZE_USD: Record<string, number> = {
  'Under $50': 50,
  '$50 to $500': 250,
  '$500 to $5,000': 2_500,
  '$5,000+': 5_000,
}
const TRADES_PER_WEEK: Record<string, number> = {
  'A few times a month': 1,
  'A few times a week': 4,
  'About once a day': 7,
  'Multiple times a day': 20,
}

// Two value-prop slides shown after the questions, before the paywall —
// each pairs with a real FeatureShowcase mock below (see those components'
// comments) instead of an invented graphic.
const slides = [
  {
    title: 'When experts agree, that’s a signal',
    body: 'When several independently-vetted top traders land on the same side of a market at once, that’s not coincidence. That’s conviction. We surface that consensus and what it’s worth.',
    cta: 'Continue',
  },
  {
    title: 'Copy trade the winners',
    body: 'The best traders on Polymarket have a real edge: information, timing, conviction. We track every position they take, the moment they take it, so their edge becomes yours too.',
    cta: 'Get started',
  },
]

// Same markup/classes as the landing page's FeatureShowcase "Alerts" card
// (see landing/components/FeatureShowcase.tsx's .ios-notif mock) — the
// exact real design, not an invented one. CSS duplicated (not imported)
// into app.css since this file and landing.css load in separate bundles.
function AlertGraphic() {
  return (
    <div className="onboarding-mini-card onboarding-mini-card-bare">
      <div className="ios-notif-stack">
        <div className="ios-notif-behind ios-notif-behind-2" />
        <div className="ios-notif-behind ios-notif-behind-1" />
        <div className="ios-notif">
          <img src="/favicon.svg" alt="" className="ios-notif-icon" />
          <div className="ios-notif-body">
            <div className="ios-notif-top">
              <span className="ios-notif-title">Whale Alert</span>
              <span className="ios-notif-time">9:41 AM</span>
            </div>
            <div className="ios-notif-sub">
              <span className="ios-notif-dot" />
              50 top traders bought $88,203.12
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// A real signal: several vetted experts on the same side of a live market,
// already in profit. Pulls the biggest current winner, filtered to the
// category the user just said they care about (Q1). Falls back to a
// representative static example if the query is slow or empty.
// Deliberately shows no timestamp — the point is what consensus is worth,
// not that any particular one just landed this second.
type SignalCard = { title: string; wallet_count: number; total_profit: number }

const CATEGORY_BY_INTEREST: Record<string, string> = { Sports: 'sports', Politics: 'politics', Crypto: 'crypto' }

const FALLBACK_BY_INTEREST: Record<string, SignalCard> = {
  Sports: { title: 'Will Arsenal FC win their next match?', wallet_count: 14, total_profit: 480_000 },
  Politics: { title: 'Will the Fed cut rates in September?', wallet_count: 7, total_profit: 142_000 },
  Crypto: { title: 'Will Bitcoin close above $120k this month?', wallet_count: 9, total_profit: 64_000 },
}
const DEFAULT_SIGNAL = FALLBACK_BY_INTEREST.Politics

function RecentSignalGraphic({ interest, betSize, frequency }: { interest?: string; betSize?: string; frequency?: string }) {
  const [signal, setSignal] = useState<SignalCard>(() => (interest && FALLBACK_BY_INTEREST[interest]) || DEFAULT_SIGNAL)

  useEffect(() => {
    let cancelled = false
    const category = interest ? CATEGORY_BY_INTEREST[interest] : undefined
    let query = supabase.from('opportunities_live')
      .select('title, wallet_count, total_profit')
      .gte('wallet_count', 4)
      .gt('total_profit', 0)
    if (category) query = query.eq('category', category)
    // Biggest current winner (in that category) — no timestamp shown, so it
    // doesn't matter that it isn't the freshest one.
    Promise.resolve(
      query.order('total_profit', { ascending: false }).limit(1).maybeSingle()
    ).then(({ data }) => {
      if (cancelled || !data) return
      setSignal({
        title: data.title as string,
        wallet_count: data.wallet_count as number,
        total_profit: data.total_profit as number,
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [interest])

  const perTrade = BET_SIZE_USD[betSize ?? ''] ?? 250
  const perWeek = TRADES_PER_WEEK[frequency ?? ''] ?? 4
  const weekly = useCountUp(perTrade * perWeek)

  return (
    <div className="onboarding-mini-card onboarding-signal-card">
      <div className="onboarding-signal-market">{signal.title}</div>
      <div className="onboarding-signal-age">
        {signal.wallet_count} independently-vetted experts agreed. They&rsquo;re up {fmtAbbrev(signal.total_profit)}.
      </div>
      <div className="onboarding-signal-math">
        Your size: <strong>${perTrade.toLocaleString('en-US')}</strong> a bet, <strong>{perWeek}x</strong> a week
      </div>
      <div className="onboarding-signal-payoff">
        That&rsquo;s <strong>$<RollingNumber value={weekly} />/week</strong> riding consensus like this
      </div>
    </div>
  )
}

// The slide CTA, held back ~2.2s so people actually read the slide instead
// of tapping straight through. Its own component so it remounts (and the
// timer restarts) with the keyed .onboarding-slide on every step; the
// setState lives in a timeout callback, not the effect body.
function SlideCta({ label, saving, onClick, delayMs = 2200 }: { label: string; saving: boolean; onClick: () => void; delayMs?: number }) {
  const [ready, setReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setReady(true), delayMs)
    return () => clearTimeout(t)
  }, [delayMs])
  return (
    <button
      className={`onboarding-option onboarding-slide-cta ${ready ? '' : 'is-locked'}`}
      disabled={saving || !ready}
      onClick={onClick}
    >
      {label}
    </button>
  )
}

export default function OnboardingPage({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  // How many of the progress segments show filled — tracked separately
  // from `step`/`answers` so a segment only lights up once you've
  // actually completed that step (answered the question, or clicked
  // through the slide), not merely while you're looking at it. That's
  // what makes the final segment's fill visibly animate on the last
  // click instead of already being lit before you get there.
  const [completedSteps, setCompletedSteps] = useState(0)
  const [saving, setSaving] = useState(false)
  // Same live, real, ever-growing counter as the landing page's Hero (see
  // lib/RollingCounter.tsx) — reused rather than reinvented, and doubly
  // relevant here since onboarding, like the landing page, runs before a
  // user has subscribed.
  const tradesAnalyzed = useLiveTradeCounter()

  const totalSteps = questions.length + slides.length
  const isQuestion = step < questions.length

  useEffect(() => {
    // Only on mount — the per-step view is tracked by the effect below,
    // this just marks that the flow was entered at all (funnel top).
    posthog.capture('onboarding_started')

    // signup_completed only ever fires from SignupPage's password path —
    // an OAuth sign-in/sign-up is the same Supabase call either way, and
    // it's a full-page redirect out to Google/Apple and back, so no code
    // of ours runs on the far side of that round trip to fire an
    // equivalent event there. This page is reached (ProtectedRoute) only
    // by a user who has never completed onboarding, which for a real
    // account only happens once — the same "first time we see them"
    // moment SignupPage's password path already reports — so firing the
    // OAuth-flavored signup_completed here, gated on provider !== email
    // to avoid double-counting the password path, closes that gap.
    void supabase.auth.getUser().then(({ data: { user } }) => {
      const provider = user?.app_metadata?.provider
      if (provider && provider !== 'email') {
        posthog.capture('signup_completed', { method: 'oauth', provider })
      }
    })
  }, [])

  useEffect(() => {
    posthog.capture('onboarding_step_viewed', {
      step: step + 1,
      total_steps: questions.length + slides.length,
      step_type: step < questions.length ? 'question' : 'slide',
      step_key: step < questions.length ? questions[step].key : slides[step - questions.length].title,
    })
  }, [step])

  const finish = async (finalAnswers: Record<string, string>) => {
    setSaving(true)
    // Onboarding runs exactly once per real account regardless of signup
    // method (see the OAuth signup_completed note above), so it's the one
    // place that reliably covers both paths for writing whatever referral
    // code ReferralRedirect.tsx left in a cookie onto the actual account —
    // the click alone (PostHog) never confirmed a signup happened. A cookie,
    // not localStorage, since the click happened on the separate
    // visibletrader.com origin — see lib/domains.ts.
    const referralCode = getReferralCode()
    await supabase.auth.updateUser({
      data: { ...finalAnswers, onboarding_completed: true, ...(referralCode ? { referral_code: referralCode } : {}) },
    })
    posthog.capture('onboarding_completed', { ...finalAnswers, ...(referralCode ? { referral_code: referralCode } : {}) })
    setSaving(false)
    onComplete()
  }

  const choose = (option: string) => {
    const next = { ...answers, [questions[step].key]: option }
    setAnswers(next)
    posthog.capture('onboarding_question_answered', { key: questions[step].key, answer: option, step: step + 1 })
    setCompletedSteps(step + 1)
    setStep(step + 1)
  }

  const advanceSlide = () => {
    const isLast = step + 1 >= totalSteps
    setCompletedSteps(step + 1)
    if (!isLast) {
      setStep(step + 1)
      return
    }
    // Give the final segment's fill transition (see app.css) time to
    // actually finish playing before finish() unmounts this page out
    // from under it, instead of cutting the sweep off mid-way.
    setSaving(true)
    setTimeout(() => void finish(answers), 450)
  }

  const current = questions[step]
  const slide = !isQuestion ? slides[step - questions.length] : null

  return (
    <div className="onboarding-root sig-page">
      <div className="onboarding-card">
        <div className="onboarding-progress">
          <div className="onboarding-progress-segments">
            {Array.from({ length: totalSteps }, (_, i) => (
              <div key={i} className={`onboarding-progress-segment${i < completedSteps ? ' filled' : ''}`} />
            ))}
          </div>
          <span className="onboarding-progress-label">{step + 1} of {totalSteps}</span>
        </div>

        {isQuestion && current && (
          <div className="onboarding-question" key={step}>
            <h1 className="onboarding-q">{current.q}</h1>
            <div className="onboarding-options">
              {current.options.map(opt => (
                <button
                  key={opt} className="onboarding-option" disabled={saving}
                  onClick={() => choose(opt)}
                >
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )}

        {slide && (() => {
          // On the signal slide the card lands first (entrance + count-up +
          // green wash, ~2s); only then does the explainer copy start. The
          // other slide keeps the quicker stagger.
          const isSignalSlide = step === questions.length
          const lineBaseMs = isSignalSlide ? 2400 : 320
          return (
          <div className={`onboarding-slide ${isSignalSlide ? 'onboarding-slide-signal' : ''}`} key={step}>
            {isSignalSlide
              ? <RecentSignalGraphic interest={answers.interest} betSize={answers.bet_size} frequency={answers.trade_frequency} />
              : <AlertGraphic />}
            <h1 className="onboarding-q onboarding-slide-title">{slide.title}</h1>
            <p className="onboarding-slide-body">
              {slide.body.split('. ').map((sentence, i, arr) => (
                <span
                  key={i}
                  className="onboarding-slide-line"
                  style={{ animationDelay: `${lineBaseMs + i * 260}ms` }}
                >
                  {sentence}{i < arr.length - 1 ? '. ' : ''}
                </span>
              ))}
            </p>
            <div className="sig-live onboarding-slide-live" style={{ marginBottom: 16 }}>
              <RollingNumber value={tradesAnalyzed} /> trades analyzed and counting
            </div>
            <SlideCta label={slide.cta} saving={saving} onClick={advanceSlide} delayMs={isSignalSlide ? 3600 : 2200} />
          </div>
          )
        })()}
      </div>
    </div>
  )
}
