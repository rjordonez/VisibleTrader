import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import posthog from './lib/posthog'
import { useLiveTradeCounter, RollingNumber } from './lib/RollingCounter'
import './app/app.css'

// Shown by ProtectedRoute for a signed-in user who hasn't been through
// this yet (user_metadata.onboarding_completed unset) — before the
// subscription check, so it applies regardless of subscription status.
// Lives next to ProtectedRoute, same reasoning: a gate page ProtectedRoute
// renders in place of the real app, not a page of the app itself (which
// lives under src/app instead).
//
// Same 3 questions as the marketing site's /estimate quiz (EstimatePage.tsx)
// — duplicated rather than imported since that page's quiz-progression
// state isn't meant to be reused as a shared component, and it's just 3
// lines of data.
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
]

// Two value-prop slides shown after the questions, before the paywall —
// each pairs with a StatRows graphic below (see that component's comment).
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

// Same stat rows shown on the landing page's ProfitCard (see
// landing/components/ProfitCard.tsx's profit-bg-row content) — reused here
// rather than the earlier hand-drawn mockup cards, split across the two
// slides to match each one's theme. Split into an .onboarding-stat-* class
// set (not landing.css's .profit-bg-*) since this file and landing.css
// load in separate bundles and neither should import the other's
// stylesheet just for this.
function StatRows({ rows }: { rows: { label: string; value: string; toneClass?: string }[] }) {
  return (
    <div className="onboarding-mini-card">
      {rows.map((r, i) => (
        <div key={r.label}>
          {i === 2 && <div className="onboarding-stat-divider" />}
          <div className="onboarding-stat-row">
            <span className="onboarding-stat-label">{r.label}</span>
            <span className={`onboarding-stat-value${r.toneClass ? ` ${r.toneClass}` : ''}`}>{r.value}</span>
          </div>
        </div>
      ))}
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
    await supabase.auth.updateUser({ data: { ...finalAnswers, onboarding_completed: true } })
    posthog.capture('onboarding_completed', finalAnswers)
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

        <div className="sig-live" style={{ marginBottom: 20 }}>
          <RollingNumber value={tradesAnalyzed} /> trades analyzed and counting
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
            {step === questions.length ? (
              <StatRows rows={[
                { label: 'Top trader win rate ($)', value: '64%', toneClass: 'green' },
                { label: 'Wallets tracked', value: '500', toneClass: 'green large' },
                { label: 'Live opportunities now', value: '286' },
                { label: 'Signal latency', value: '<1s' },
              ]} />
            ) : (
              <StatRows rows={[
                { label: 'Live opportunities now', value: '286' },
                { label: 'Signal latency', value: '<1s' },
                { label: 'Top trader win rate ($)', value: '64%', toneClass: 'green' },
                { label: 'Wallets tracked', value: '500', toneClass: 'green large' },
              ]} />
            )}
            <h1 className="onboarding-q onboarding-slide-title">{slide.title}</h1>
            <p className="onboarding-slide-body">{slide.body}</p>
            <button className="onboarding-option onboarding-slide-cta" disabled={saving} onClick={advanceSlide}>
              {slide.cta}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
