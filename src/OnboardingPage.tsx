import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import posthog from './lib/posthog'
import { useLiveTradeCounter, RollingNumber } from './lib/RollingCounter'
import { getReferralCode } from './lib/domains'
import './app/app.css'

// Shown by ProtectedRoute for a signed-in user who hasn't been through
// this yet (user_metadata.onboarding_completed unset) — before the
// subscription check, so it applies regardless of subscription status.
// Lives next to ProtectedRoute, same reasoning: a gate page ProtectedRoute
// renders in place of the real app, not a page of the app itself (which
// lives under src/app instead).
//
// First 3 questions match the marketing site's /estimate quiz
// (EstimatePage.tsx) — duplicated rather than imported since that page's
// quiz-progression state isn't meant to be reused as a shared component.
// The 4th (feature_interest) is onboarding-only, used to tailor which
// tile/page we could point a user at first.
const questions = [
  {
    key: 'interest',
    q: 'Which markets do you care about most?',
    options: ['Sports', 'Politics', 'Crypto', 'Everything'],
  },
  {
    key: 'signal_priority',
    q: 'What matters most when following a signal?',
    options: ['Win rate track record', 'How fast it moves', 'Position size', 'All of it'],
  },
  {
    key: 'experience',
    q: 'How familiar are you with Polymarket?',
    options: ['Brand new', "I've placed a few bets", 'Active trader', 'I trade daily'],
  },
  {
    key: 'feature_interest',
    q: 'What are you here for?',
    options: ['Live signals & alerts', 'Browsing markets (Terminal)', 'Leaderboard of top traders', 'Tracking my own P&L'],
  },
]

// Two value-prop slides shown after the questions, before the paywall —
// each pairs with a real FeatureShowcase mock below (see those components'
// comments) instead of an invented graphic.
const slides = [
  {
    title: 'Copy trade the winners',
    body: 'The best traders on Polymarket have a real edge: information, timing, conviction. We track every position they take, the moment they take it, so their edge becomes yours too.',
    cta: 'Continue',
  },
  {
    title: 'When experts agree, that’s a signal',
    body: 'When several independently-vetted top traders land on the same side of a market at once, that’s not coincidence. That’s conviction. We surface consensus the instant it forms.',
    cta: 'Get started',
  },
]

// Same markup/classes as the landing page's FeatureShowcase "Alerts" card
// (see landing/components/FeatureShowcase.tsx's .ios-notif mock) — the
// exact real design, not an invented one. CSS duplicated (not imported)
// into app.css since this file and landing.css load in separate bundles.
function AlertGraphic() {
  return (
    <div className="onboarding-mini-card">
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

// Same markup/classes as FeatureShowcase's "Vetted Picks" card.
function VettedGraphic() {
  return (
    <div className="onboarding-mini-card">
      <div className="showcase-vp-row">
        <span className="showcase-vp-market">Diamondbacks vs. Nationals</span>
        <span className="showcase-vp-badge">9 wallets · $91.9k</span>
      </div>
      <div className="showcase-vp-row">
        <span className="showcase-vp-market">CF América win market</span>
        <span className="showcase-vp-badge">6 wallets · $21.2k</span>
      </div>
      <div className="showcase-vp-row">
        <span className="showcase-vp-market">US x Iran ceasefire</span>
        <span className="showcase-vp-badge">5 wallets · $2.2k</span>
      </div>
    </div>
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
          <>
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
          </>
        )}

        {slide && (
          <>
            {step === questions.length ? <AlertGraphic /> : <VettedGraphic />}
            <h1 className="onboarding-q onboarding-slide-title">{slide.title}</h1>
            <p className="onboarding-slide-body">{slide.body}</p>
            <div className="sig-live" style={{ marginBottom: 16 }}>
              <RollingNumber value={tradesAnalyzed} /> trades analyzed and counting
            </div>
            <button className="onboarding-option onboarding-slide-cta" disabled={saving} onClick={advanceSlide}>
              {slide.cta}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
