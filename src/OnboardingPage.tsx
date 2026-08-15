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

export default function OnboardingPage({ onComplete }: { onComplete: () => void }) {
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)

  const finish = async (finalAnswers: Record<string, string>) => {
    setSaving(true)
    await supabase.auth.updateUser({ data: { ...finalAnswers, onboarding_completed: true } })
    setSaving(false)
    onComplete()
  }

  const choose = (option: string) => {
    const next = { ...answers, [questions[step].key]: option }
    setAnswers(next)
    if (step + 1 < questions.length) setStep(step + 1)
    else void finish(next)
  }

  const skip = () => void finish(answers)

  const current = questions[step]

  return (
    <div className="onboarding-root">
      <div className="onboarding-card">
        <div className="onboarding-progress">
          <div className="onboarding-progress-track">
            <div className="onboarding-progress-fill" style={{ width: `${((step + 1) / questions.length) * 100}%` }} />
          </div>
          <span className="onboarding-progress-label">{step + 1} of {questions.length}</span>
        </div>

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

        <button className="onboarding-skip" disabled={saving} onClick={skip}>
          Skip for now
        </button>
      </div>
    </div>
  )
}
