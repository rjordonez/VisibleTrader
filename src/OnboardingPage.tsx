import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'
import posthog from './lib/posthog'
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
// each graphic is a small inline mockup (no image assets), same approach
// already used for the landing page's WinnersPreview.
const slides = [
  {
    title: 'Copy trade the winners',
    body: 'The best traders on Polymarket have a real edge — information, timing, conviction. We track every position they take, the moment they take it, so their edge becomes yours too.',
    cta: 'Continue',
  },
  {
    title: 'When experts agree, that’s a signal',
    body: 'When several independently-vetted top traders land on the same side of a market at once, that’s not coincidence — that’s conviction. We surface consensus the instant it forms.',
    cta: 'Get started',
  },
]

function SignalGraphic() {
  return (
    <div className="onboarding-mini-card">
      <div className="onboarding-mini-card-top">
        <span className="onboarding-mini-icon">⚡</span>
        <div>
          <div className="onboarding-mini-title">3 top traders just bought in</div>
          <div className="onboarding-mini-sub">Fed rate decision — Yes</div>
        </div>
      </div>
      <div className="onboarding-mini-badge">Live · 12s ago</div>
    </div>
  )
}

// Matches the real in-app chart's visual language (gradient fill, smooth
// curve, dashed grid, solid endpoint dot — see PriceChart.tsx) instead of a
// bare polyline, so this reads as an authentic product preview rather than
// a generic placeholder squiggle.
function ChartGraphic() {
  return (
    <div className="onboarding-mini-card onboarding-mini-card-chart">
      <svg width="100%" height="72" viewBox="0 0 180 72" fill="none" preserveAspectRatio="none">
        <defs>
          <linearGradient id="onboardingChartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00d17a" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#00d17a" stopOpacity="0" />
          </linearGradient>
        </defs>
        <line x1="0" y1="20" x2="180" y2="20" stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4" />
        <line x1="0" y1="44" x2="180" y2="44" stroke="var(--border)" strokeWidth="1" strokeDasharray="2 4" />
        <path
          d="M0,58 C15,54 15,52 30,50 C45,48 45,52 60,54 C75,56 75,38 90,32 C105,26 105,36 120,38 C135,40 135,20 150,16 C165,12 165,13 180,12 L180,72 L0,72 Z"
          fill="url(#onboardingChartFill)"
        />
        <path
          d="M0,58 C15,54 15,52 30,50 C45,48 45,52 60,54 C75,56 75,38 90,32 C105,26 105,36 120,38 C135,40 135,20 150,16 C165,12 165,13 180,12"
          stroke="#00d17a" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round"
        />
        <circle cx="180" cy="12" r="4.5" fill="#00d17a" />
      </svg>
      <div className="onboarding-mini-stat">
        <span className="onboarding-mini-stat-value">57.4%</span>
        <span className="onboarding-mini-stat-label">real win rate, fully tracked</span>
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
            {step === questions.length ? <ChartGraphic /> : <SignalGraphic />}
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
