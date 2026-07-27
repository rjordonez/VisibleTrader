import { useNavigate } from 'react-router-dom'

export default function ProfitCard() {
  const navigate = useNavigate()

  return (
    <div className="profit-card-outer">

    {/* ── Platform logo – floating top-right corner ── */}
    <div className="profit-platform-logos">
      <img src="/polymarket.png" alt="Polymarket"  className="profit-logo profit-logo-poly"   />
    </div>

    <div className="profit-locked-card">
      {/* Blurred background content */}
      <div className="profit-bg-content" aria-hidden>
        <div className="profit-bg-row">
          <span className="profit-bg-label">Top trader win rate ($)</span>
          <span className="profit-bg-value green">64%</span>
        </div>
        <div className="profit-bg-row">
          <span className="profit-bg-label">Wallets tracked</span>
          <span className="profit-bg-value green large">500</span>
        </div>
        <div className="profit-bg-divider" />
        <div className="profit-bg-row">
          <span className="profit-bg-label">Live opportunities now</span>
          <span className="profit-bg-value">286</span>
        </div>
        <div className="profit-bg-row">
          <span className="profit-bg-label">Signal latency</span>
          <span className="profit-bg-value">&lt;1s</span>
        </div>
        <div className="profit-bg-bar-group">
          <div className="profit-bg-bar" style={{ height: 32, background: 'rgba(99,102,241,0.6)' }} />
          <div className="profit-bg-bar" style={{ height: 48, background: 'rgba(16,185,129,0.6)' }} />
          <div className="profit-bg-bar" style={{ height: 24, background: 'rgba(99,102,241,0.5)' }} />
          <div className="profit-bg-bar" style={{ height: 60, background: 'rgba(16,185,129,0.7)' }} />
          <div className="profit-bg-bar" style={{ height: 40, background: 'rgba(99,102,241,0.55)' }} />
          <div className="profit-bg-bar" style={{ height: 52, background: 'rgba(16,185,129,0.6)' }} />
        </div>
      </div>

      {/* Frosted glass overlay */}
      <div className="profit-glass-overlay">
        <svg className="profit-lock-svg" width="26" height="30" viewBox="0 0 26 30" fill="none">
          <rect x="1" y="12" width="24" height="17" rx="4" stroke="white" strokeWidth="1.75"/>
          <path d="M6 12V8.5a7 7 0 0114 0V12" stroke="white" strokeWidth="1.75" strokeLinecap="round"/>
          <circle cx="13" cy="20.5" r="2.5" fill="white"/>
        </svg>
        <h3 className="profit-glass-title">See real, tracked performance<br />before you sign up</h3>
        <button className="profit-glass-btn" onClick={() => navigate('/estimate')}>
          See a live example
        </button>
      </div>
    </div>

    </div>
  )
}
