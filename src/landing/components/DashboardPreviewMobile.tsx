import { Activity, Landmark, Menu, Home, Zap, TrendingUp, Trophy, Bell } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area } from 'recharts'

// Same illustrative-only rule as DashboardPreview.tsx: this is a static
// marketing mockup (phone-frame version, shown only below the 768px
// breakpoint where the desktop browser-chrome mockup hides itself as "too
// dense"), never wired to real data.
const demoTrend = [0, 34000, 29000, 68000, 91000, 82000, 121000, 149000, 138000, 183000, 214000, 251000, 236000, 289000, 331000, 368000, 412558]

const cards = [
  { Icon: Activity, market: 'Arizona Diamondbacks', outcome: 'vs. Nationals', wallets: 9, price: '53¢', total: '$91,947', profit: '+$80,533', tag: '$91.9k TIER' },
  { Icon: Landmark, market: 'US x Iran Ceasefire', outcome: 'by July 24?', wallets: 5, price: '15¢', total: '$2,179', profit: '+$331', tag: '$2.2k TIER' },
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

export default function DashboardPreviewMobile() {
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
              <div className="dash-title">Top Trader Signals</div>
              <div className="dash-subtitle">286 live opportunities</div>
            </div>

            <div className="dash-chart-panel">
              <div className="dash-chart-panel-label">Cumulative tracked profit</div>
              <div className="dash-chart-panel-value">+$412,558</div>
              <ResponsiveContainer width="100%" height={56}>
                <AreaChart data={demoTrend.map((v, i) => ({ i, v }))} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="phoneTrendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="var(--green)" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="var(--green)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area
                    type="monotone" dataKey="v" stroke="var(--green)" strokeWidth={2}
                    fill="url(#phoneTrendGradient)" isAnimationActive={false}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>

            <div className="phone-card-stack">
              {cards.map((c, i) => (
                <div key={i} className="dash-card">
                  <div className="dash-card-top">
                    <div className="dash-card-icon"><c.Icon size={13} /></div>
                    <div className="dash-card-titles">
                      <div className="dash-card-market">{c.market} <span>{c.outcome}</span></div>
                      <div className="dash-card-meta">{c.wallets} top traders</div>
                    </div>
                    <div className="dash-card-profit">{c.profit}</div>
                  </div>
                  <div className="dash-card-stats">
                    <div className="dash-card-stat"><span>Price</span><b>{c.price}</b></div>
                    <div className="dash-card-stat"><span>Total</span><b className="green">{c.total}</b></div>
                  </div>
                  <div className="dash-card-tag">{c.tag}</div>
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
