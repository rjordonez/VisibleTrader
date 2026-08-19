import { useState } from 'react'
import { supabase } from './lib/supabase'

// Shown by ProtectedRoute for a signed-in user who hasn't been through
// this yet (user_metadata.onboarding_completed unset) — before the
// paywall check, so it applies regardless of subscription status. Lives
// next to ProtectedRoute/PaywallPage, same reasoning as those: a gate
// page ProtectedRoute renders in place of the real app, not a page of
// the app itself (which lives under src/app instead).
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
// already used for the landing page's DashboardPreview.
const slides = [
  {
    title: 'Never miss a signal',
    body: "The moment multiple top-performing wallets buy into the same market, you get the alert — real-time, not end-of-day.",
    cta: 'Continue',
  },
  {
    title: 'Real, verified track record',
    body: 'Every trader’s resolved P&L is tracked and shown — wins and losses both, not cherry-picked screenshots.',
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

function ChartGraphic() {
  return (
    <div className="onboarding-mini-card onboarding-mini-card-chart">
      <svg width="100%" height="64" viewBox="0 0 180 64" fill="none" preserveAspectRatio="none">
        <polyline
          points="0,50 30,42 60,46 90,26 120,32 150,12 180,8"
          stroke="#00d17a" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round"
        />
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

  const finish = async (finalAnswers: Record<string, string>) => {
    setSaving(true)
    await supabase.auth.updateUser({ data: { ...finalAnswers, onboarding_completed: true } })
    setSaving(false)
    onComplete()
  }

  const choose = (option: string) => {
    const next = { ...answers, [questions[step].key]: option }
    setAnswers(next)
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
    <div className="onboarding-root">
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
            {step === questions.length ? <SignalGraphic /> : <ChartGraphic />}
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
