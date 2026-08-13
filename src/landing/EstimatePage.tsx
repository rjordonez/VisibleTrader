import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import './landing.css'

const questions = [
  {
    q: 'Which markets do you care about most?',
    options: ['Sports', 'Politics', 'Crypto', 'Everything'],
  },
  {
    q: 'What matters most when following a signal?',
    options: ['Win rate track record', 'How fast it moves', 'Position size', 'All of it'],
  },
  {
    q: 'How familiar are you with Polymarket?',
    options: ['Brand new', "I've placed a few bets", 'Active trader', 'I trade daily'],
  },
]

const sampleByInterest = [
  { cat: 'Sports',     example: '9 tracked wallets converged on one MLB spread within minutes of each other.' },
  { cat: 'Politics',   example: 'A ceasefire market moved on tracked-wallet volume before headlines caught up.' },
  { cat: 'Crypto',     example: 'Real-time price history shows exactly where each tracked wallet bought in.' },
  { cat: 'Everything', example: '286 live opportunities across every category, ranked by real conviction.' },
]

type Step = 'q0' | 'q1' | 'q2' | 'email' | 'result'
const nextStep: Record<string, Step> = { q0: 'q1', q1: 'q2', q2: 'email' }

export default function EstimatePage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('q0')
  const [answers, setAnswers] = useState<number[]>([])
  const [email, setEmail] = useState('')
  const [selected, setSelected] = useState<number | null>(null)

  const qIndex = step === 'q0' ? 0 : step === 'q1' ? 1 : step === 'q2' ? 2 : -1
  const currentQ = qIndex >= 0 ? questions[qIndex] : null

  function choose(optionIndex: number) {
    setSelected(null)
    setAnswers(prev => [...prev, optionIndex])
    setStep(nextStep[step] as Step)
  }

  function submitEmail(e: React.FormEvent) {
    e.preventDefault()
    const interest = questions[0].options[answers[0]] ?? null
    void supabase.from('leads').insert({ email, source: 'estimate_quiz', interest })
    setStep('result')
  }

  const sample = step === 'result' ? sampleByInterest[answers[0] ?? 3] : null

  return (
    <div className="ep-root">
      {/* Logo */}
      <div className="ep-topbar">
        <button className="ep-logo" onClick={() => navigate('/')}>
          VisibleTrader
        </button>
      </div>


      <div className="ep-content">

        {/* ── Questions ── */}
        {currentQ && (
          <div className="ep-fade-in">
            <div className="ep-progress">
              <div className="ep-progress-track">
                <div className="ep-progress-fill" style={{ width: `${(qIndex / 3) * 100}%` }} />
              </div>
              <span className="ep-progress-label">{qIndex + 1} of 3</span>
            </div>

            <h1 className="ep-q">{currentQ.q}</h1>

            <div className="ep-options">
              {currentQ.options.map((opt, i) => (
                <button
                  key={opt}
                  className={`ep-option ${selected === i ? 'ep-option-selected' : ''}`}
                  onClick={() => {
                    setSelected(i)
                    setTimeout(() => choose(i), 180)
                  }}
                >
                  <span className="ep-option-letter">{String.fromCharCode(65 + i)}</span>
                  {opt}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Email ── */}
        {step === 'email' && (
          <div className="ep-fade-in">
            <div className="ep-check-badge">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2.5 7l3 3 6-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Almost done
            </div>

            <h1 className="ep-headline">
              Drop your email and we'll show you<br />
              a live example from the dashboard.
            </h1>

            <p className="ep-sub">No spam, just a preview of what you'd see.</p>

            <form onSubmit={submitEmail} className="ep-email-form">
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="ep-input"
                autoFocus
              />
              <button type="submit" className="ep-btn">Show me the preview →</button>
            </form>

            <p className="ep-fine">No spam. Unsubscribe anytime.</p>
          </div>
        )}

        {/* ── Result ── */}
        {step === 'result' && sample && (
          <div className="ep-fade-in">
            <div className="ep-check-badge">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <path d="M2.5 7l3 3 6-6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Based on your answers
            </div>

            <h1 className="ep-headline">
              Since you're into {sample.cat.toLowerCase()},<br />here's what you'd see:
            </h1>

            <div className="ep-result-line">
              <span className="ep-result-inline-text">
                {sample.example}
              </span>
            </div>

            <div className="ep-platform-logos">
              <span className="ep-platform-pill">Polymarket</span>
            </div>

            <p className="ep-plus-line">
              This is a real example, not a projection of what you'll personally earn. Individual results vary and every trade carries risk.
            </p>

            <a href={`/signup?email=${encodeURIComponent(email)}`} className="ep-btn" style={{ display: 'inline-block' }}>Try for free</a>

            <div className="ep-links">
              <button className="ep-link" onClick={() => navigate('/#tools')}>See how signals are ranked</button>
              <button className="ep-link" onClick={() => navigate('/#faq')}>Read the FAQ</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
