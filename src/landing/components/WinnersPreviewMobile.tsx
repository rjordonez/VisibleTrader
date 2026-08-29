import { Menu, Home, Zap, TrendingUp, Trophy, Bell } from 'lucide-react'

// Same illustrative-only rule as WinnersPreview.tsx: this is a static
// marketing mockup (phone-frame version, shown only below the 768px
// breakpoint where the desktop browser-chrome mockup hides itself as "too
// dense"), never wired to real data.
const rows = [
  { initial: 'C', bg: 'linear-gradient(135deg, #ca8a04, #facc15)', name: 'coinwatcher92', status: 'Won', time: '12s ago', market: 'Will the Fed cut rates in September?', outcome: 'Yes', pnl: '+$62,340', pct: '71.2%', staked: '$87,550', legs: '1 leg' },
  { initial: '0', bg: 'linear-gradient(135deg, #9333ea, #c084fc)', name: '0x4Ab9…e21c', status: 'Won', time: '48s ago', market: 'Lakers vs. Warriors', outcome: 'Lakers', pnl: '+$18,920', pct: '44.6%', staked: '$42,400', legs: '1 leg' },
  { initial: 'N', bg: 'linear-gradient(135deg, #0891b2, #22d3ee)', name: 'nightowl77', status: 'Exited', time: '1m ago', market: 'Will Bitcoin close above $130k in August?', outcome: 'Yes', pnl: '+$9,410', pct: '22.8%', staked: '$41,280', legs: '2 legs' },
]

// Mirrors the real app's tab order (src/app/index.tsx's navItems) — icons
// added here since a text-only tab bar reads as a webpage, not an app;
// the real app uses a hamburger menu on mobile instead, but this is a
// marketing mockup meant to look like a native app, not a pixel-accurate
// clone of the real nav.
const bottomNavItems = [
  { Icon: Home, label: 'Home' },
  { Icon: Zap, label: 'Signals', active: true },
  { Icon: TrendingUp, label: 'Profits' },
  { Icon: Trophy, label: 'Leaders' },
  { Icon: Bell, label: 'Alerts' },
]

export default function WinnersPreviewMobile() {
  return (
    <div className="phone-container">
      <div className="phone-hero-overlay">
        <h2 className="phone-hero-headline">
          Never miss a signal.<br />Never trade alone.
        </h2>
        <p className="phone-hero-sub">
          Real-time alerts the moment top traders move — with a fully verified track record.
        </p>
      </div>
      <div className="phone-frame">
        <span className="phone-btn phone-btn-mute" />
        <span className="phone-btn phone-btn-vol-up" />
        <span className="phone-btn phone-btn-vol-down" />
        <span className="phone-btn phone-btn-power" />
        <div className="phone-screen">
          <div className="phone-island" />
          <div className="phone-content">
            <div className="phone-topbar">
              <span className="phone-logo">VisibleTrader</span>
              <Menu size={16} />
            </div>

            <div className="phone-title-row">
              <div className="dash-title">Winners</div>
              <div className="dash-subtitle">Closed, profitable positions</div>
            </div>

            <div className="wp-mobile-list">
              {rows.map((r, i) => (
                <div className="wp-mobile-card" key={i}>
                  <div className="wp-mobile-market">{r.market} <span>— {r.outcome}</span></div>
                  <div className="wp-mobile-trader">
                    <div className="wp-avatar" style={{ background: r.bg }}>{r.initial}</div>
                    <div>
                      <div className="wp-mobile-name">{r.name}</div>
                      <div className="wp-mobile-sub">{r.status} · {r.time}</div>
                    </div>
                  </div>
                  <div className="wp-mobile-stats">
                    <div className="wp-mobile-stat">
                      <div className="wp-mobile-stat-label">PnL</div>
                      <div className="wp-mobile-stat-val g">{r.pnl}</div>
                      <div className="wp-mobile-stat-sub g">▲ {r.pct}</div>
                    </div>
                    <div className="wp-mobile-stat">
                      <div className="wp-mobile-stat-label">Staked</div>
                      <div className="wp-mobile-stat-val">{r.staked}</div>
                      <div className="wp-mobile-stat-sub">{r.legs}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="phone-bottom-nav">
            {bottomNavItems.map(({ Icon, label, active }) => (
              <div key={label} className={`phone-bottom-nav-item ${active ? 'active' : ''}`}>
                <Icon size={18} />
                <span>{label}</span>
              </div>
            ))}
          </div>
          <div className="phone-home-indicator" />
        </div>
      </div>
    </div>
  )
}
