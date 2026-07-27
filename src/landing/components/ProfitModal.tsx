import { useState, useEffect } from 'react'

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

interface Props {
  onClose: () => void
}

export default function ProfitModal({ onClose }: Props) {
  const [step, setStep] = useState<Step>('q0')
  const [answers, setAnswers] = useState<number[]>([])
  const [email, setEmail] = useState('')
  const [selected, setSelected] = useState<number | null>(null)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const qIndex = step === 'q0' ? 0 : step === 'q1' ? 1 : step === 'q2' ? 2 : -1
  const currentQ = qIndex >= 0 ? questions[qIndex] : null
  const nextStep: Record<string, Step> = { q0: 'q1', q1: 'q2', q2: 'email' }

  function choose(optionIndex: number) {
    setSelected(null)
    setAnswers(prev => [...prev, optionIndex])
    setStep(nextStep[step] as Step)
  }

  function submitEmail(e: React.FormEvent) {
    e.preventDefault()
    setStep('result')
  }

  const sample = step === 'result' ? sampleByInterest[answers[0] ?? 3] : null

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal-box">
        {/* Close */}
        <button className="modal-close" onClick={onClose} aria-label="Close">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M2 2l12 12M14 2L2 14" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Question steps */}
        {currentQ && (
          <>
            <div className="modal-step-bar">
              {[0, 1, 2].map(n => (
                <div key={n} className={`modal-step-dot ${n <= qIndex ? 'active' : ''}`} />
              ))}
              <span className="modal-step-label">Step {qIndex + 1} of 3</span>
            </div>
            <h2 className="modal-q-title">{currentQ.q}</h2>
            <div className="modal-options">
              {currentQ.options.map((opt, i) => (
                <button
                  key={opt}
                  className={`modal-option ${selected === i ? 'selected' : ''}`}
                  onClick={() => {
                    setSelected(i)
                    setTimeout(() => choose(i), 180)
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Email step */}
        {step === 'email' && (
          <>
            <div className="modal-email-icon">✉️</div>
            <h2 className="modal-q-title">One last thing</h2>
            <p className="modal-email-sub">
              Enter your email and we'll show you a live example from the dashboard.
            </p>
            <form onSubmit={submitEmail} style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
              <input
                type="email"
                placeholder="Your email address"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                className="modal-email-input"
                autoFocus
              />
              <button type="submit" className="btn-primary" style={{ padding: '0.8rem', fontSize: '0.9375rem' }}>
                Show me the preview →
              </button>
            </form>
            <p className="modal-disclaimer">No spam. Unsubscribe anytime.</p>
          </>
        )}

        {/* Result step */}
        {step === 'result' && sample && (
          <>
            <div className="modal-result-badge">Since you're into {sample.cat.toLowerCase()}</div>
            <div className="modal-result-nums" style={{ textAlign: 'left' }}>
              <p style={{ fontSize: '0.95rem', lineHeight: 1.5, margin: 0 }}>{sample.example}</p>
            </div>
            <p className="modal-disclaimer" style={{ marginBottom: '1.25rem' }}>
              A real example, not a projection of what you'll personally earn — individual results vary and every trade carries risk.
            </p>
            <a href="/app" className="btn-primary" style={{ display: 'block', textAlign: 'center', padding: '0.8rem', fontSize: '0.9375rem' }}>
              Start free trial →
            </a>
            <button className="btn-ghost" style={{ width: '100%', textAlign: 'center', marginTop: '0.5rem' }} onClick={onClose}>
              ← Back to home
            </button>
          </>
        )}
      </div>
    </div>
  )
}
