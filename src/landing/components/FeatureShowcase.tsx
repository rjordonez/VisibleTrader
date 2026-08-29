import { ShieldCheck } from 'lucide-react'

// Real product UI mockups (same convention as Features.tsx's .bento-mock
// cards below), not illustrated character art — kept simple/on-brand
// instead of the stylized-3D-avatar look from the earlier draft.
// Custom gold/silver/bronze badges instead of medal emoji — emoji glyphs
// render inconsistently across platforms and clash with the site's own
// flat-circle avatar style used everywhere else.
const medalColors = [
  'linear-gradient(135deg, #f5c542, #b8860b)',
  'linear-gradient(135deg, #d8d8d8, #8e8e8e)',
  'linear-gradient(135deg, #cd8a4f, #8b5a2b)',
]
const leaders = [
  { rank: 1, initial: 'C', bg: 'linear-gradient(135deg, #ca8a04, #facc15)', name: 'coinwatcher92', handle: '@coinwatcher92', pnl: '+$1,726,513' },
  { rank: 2, initial: 'F', bg: 'linear-gradient(135deg, #9333ea, #c084fc)', name: '0x4Ab9…e21c', handle: '@0x4Ab9e21c', pnl: '+$1,236,362' },
  { rank: 3, initial: 'L', bg: 'linear-gradient(135deg, #0891b2, #22d3ee)', name: 'nightowl77', handle: '@nightowl77', pnl: '+$810,605' },
  { rank: 4, initial: 'Q', bg: 'linear-gradient(135deg, #1e8f0d, #56ab4a)', name: 'quietrisk', handle: '@quietrisk', pnl: '+$685,392' },
]

export default function FeatureShowcase() {
  return (
    <section className="section">
      <div className="section-inner">
        <div className="showcase-head">
          <h2 className="showcase-headline">
            Everything you need to<br />trade like the whales do
          </h2>
        </div>

        <div className="showcase-grid">
          {/* Leaderboard */}
          <div className="showcase-card">
            <span className="showcase-eyebrow">Leaderboard</span>
            <h3 className="showcase-card-title">Find winning traders,<br />ranked by real P&L</h3>
            <div className="showcase-mock showcase-mock-leaderboard">
              {leaders.map(l => (
                <div className="showcase-lb-row" key={l.rank}>
                  {l.rank <= 3 ? (
                    <span className="showcase-lb-medal" style={{ background: medalColors[l.rank - 1] }}>{l.rank}</span>
                  ) : (
                    <span className="showcase-lb-rank-plain">{l.rank}</span>
                  )}
                  <div className="showcase-lb-avatar" style={{ background: l.bg }}>{l.initial}</div>
                  <div className="showcase-lb-names">
                    <span className="showcase-lb-name">{l.name}</span>
                    <span className="showcase-lb-handle">{l.handle}</span>
                  </div>
                  <span className="showcase-lb-pnl">{l.pnl}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Alerts */}
          <div className="showcase-card">
            <span className="showcase-eyebrow">Alerts</span>
            <h3 className="showcase-card-title">Real-time notifications for what the whales are buying</h3>
            <div className="showcase-mock showcase-mock-alert">
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
          </div>

          {/* Profits */}
          <div className="showcase-card">
            <span className="showcase-eyebrow">Profits</span>
            <h3 className="showcase-card-title">Track your profits,<br />anytime, anywhere</h3>
            <div className="showcase-mock showcase-mock-chart">
              <img src="/showcase-image-3.png" alt="" />
            </div>
          </div>

          {/* Vetted picks */}
          <div className="showcase-card">
            <span className="showcase-eyebrow">Vetted Picks</span>
            <h3 className="showcase-card-title">See group conviction</h3>
            <div className="showcase-mock showcase-mock-vetted">
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
          </div>

          {/* Easy onboarding — buttons here are illustrative (match
              OAuthButtons.tsx's real icons/copy) rather than wired to a
              real signIn call, same as every other card's mockup. */}
          <div className="showcase-card">
            <span className="showcase-eyebrow">Easy Onboarding</span>
            <h3 className="showcase-card-title">Create an account<br />in an instant</h3>
            <div className="showcase-mock showcase-mock-onboard">
              <div className="showcase-oauth-btn showcase-oauth-apple">
                <svg width="16" height="18" viewBox="0 0 16 18" fill="currentColor">
                  <path d="M13.15 9.55c-.02-2.03 1.66-3 1.74-3.06-.95-1.39-2.42-1.58-2.95-1.6-1.26-.13-2.45.74-3.09.74-.64 0-1.62-.72-2.66-.7-1.37.02-2.63.8-3.34 2.02-1.42 2.47-.36 6.14 1.02 8.14.68.98 1.48 2.08 2.54 2.04 1.02-.04 1.4-.66 2.63-.66 1.23 0 1.58.66 2.66.64 1.1-.02 1.79-.99 2.46-1.98.77-1.13 1.09-2.23 1.1-2.28-.02-.01-2.1-.81-2.12-3.2Z"/>
                  <path d="M11.16 3.5c.56-.68.94-1.62.83-2.56-.81.03-1.79.54-2.37 1.21-.52.6-.97 1.56-.85 2.48.9.07 1.82-.46 2.39-1.13Z"/>
                </svg>
                Sign in with Apple
              </div>
              <div className="showcase-oauth-btn showcase-oauth-google">
                <svg width="16" height="16" viewBox="0 0 18 18">
                  <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.56 2.7-3.87 2.7-6.62Z"/>
                  <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18Z"/>
                  <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.17.28-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33Z"/>
                  <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58Z"/>
                </svg>
                Sign in with Google
              </div>
              <img src="/showcase-hand.png" alt="" className="showcase-hand" />
            </div>
          </div>

          {/* Non-custodial trust card */}
          <div className="showcase-card">
            <span className="showcase-eyebrow">Non-Custodial</span>
            <h3 className="showcase-card-title">We never touch<br />your funds</h3>
            <div className="showcase-mock showcase-mock-trust">
              <img src="/showcase-lock.png" alt="" className="showcase-lock-img" />
              <div className="showcase-trust-row">
                <ShieldCheck size={16} />
                <span>We only read public on-chain data — never your funds, never your keys.</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
