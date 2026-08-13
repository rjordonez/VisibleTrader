import { Activity, Landmark } from 'lucide-react'
import { ResponsiveContainer, AreaChart, Area } from 'recharts'

// Illustrative only — this whole component is a static marketing mockup of
// the dashboard (fake markets, fake wallet counts, fake everything above),
// not a view onto real user or trading data. This trend line is the same:
// hand-picked numbers chosen to read as a clean up-and-to-the-right curve
// for the landing page, never wired to profits_daily or any other real
// source. Keep it that way — this file must never import real data fetches.
const demoTrend = [0, 34000, 29000, 68000, 91000, 82000, 121000, 149000, 138000, 183000, 214000, 251000, 236000, 289000, 331000, 368000, 412558]

// Mirrors AppShell's actual top nav (src/app/index.tsx) — Home/Signals/
// Profits/Leaderboard/Alerts/Lookup, text-only, no Settings (that lives
// in the account menu, not the main tab row).
const navItems = ['Home', 'Signals', 'Profits', 'Leaderboard', 'Alerts', 'Lookup']

const cards = [
  { Icon: Activity, market: 'Arizona Diamondbacks', outcome: 'vs. Nationals', wallets: 9, price: '53¢', total: '$91,947', pct: 88, profit: '+$80,533', tag: '$91.9k TIER' },
  { Icon: Landmark, market: 'US x Iran Ceasefire', outcome: 'by July 24?', wallets: 5, price: '15¢', total: '$2,179', pct: 60, profit: '+$331', tag: '$2.2k TIER' },
  { Icon: Activity, market: 'CF América', outcome: 'win on 07-24?', wallets: 6, price: '71¢', total: '$21,160', pct: 100, profit: '+$42,516', tag: '$21.2k TIER' },
]

function CardGauge({ pct }: { pct: number }) {
  const color = pct >= 80 ? '#00d17a' : pct >= 50 ? '#f2b73f' : '#ff3b5c'
  return (
    <div
      className="dash-card-gauge"
      style={{ background: `conic-gradient(${color} ${pct * 3.6}deg, rgba(255,255,255,0.08) 0deg)` }}
    >
      <div className="dash-card-gauge-hole">
        <span>{pct}%</span>
      </div>
    </div>
  )
}

export default function DashboardPreview() {
  return (
    <div className="dashboard-container">
    <div className="dashboard-wrap">
      {/* Browser chrome */}
      <div className="dashboard-chrome">
        <div className="chrome-dots">
          <span /><span /><span />
        </div>
        <div className="chrome-bar">app.visibletrader.com/signals</div>
        <div className="chrome-spacer" />
      </div>

      {/* Top nav */}
      <div className="dash-topnav">
        {navItems.map(label => (
          <div key={label} className={`dash-nav-item ${label === 'Signals' ? 'active' : ''}`}>
            {label}
          </div>
        ))}
      </div>

      {/* Dashboard body */}
      <div className="dashboard-body">
        {/* Main content */}
        <div className="dash-main">
          <div className="dash-topbar">
            <div>
              <div className="dash-title">Top Trader Signals</div>
              <div className="dash-subtitle">286 live opportunities · capital-weighted conviction from top traders</div>
            </div>
            <div className="dash-filters">
              <span className="dash-filter active">All</span>
              <span className="dash-filter">Sports</span>
              <span className="dash-filter">Politics</span>
            </div>
          </div>

          <div className="dash-chart-panel">
            <div className="dash-chart-panel-label">Cumulative tracked profit</div>
            <div className="dash-chart-panel-value">+$412,558</div>
            <ResponsiveContainer width="100%" height={64}>
              <AreaChart data={demoTrend.map((v, i) => ({ i, v }))} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="dashTrendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--green)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--green)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <Area
                  type="monotone" dataKey="v" stroke="var(--green)" strokeWidth={2}
                  fill="url(#dashTrendGradient)" isAnimationActive={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="dash-card-grid">
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
                <div className="dash-card-body">
                  <CardGauge pct={c.pct} />
                  <div className="dash-card-stats">
                    <div className="dash-card-stat"><span>Price</span><b>{c.price}</b></div>
                    <div className="dash-card-stat"><span>Total</span><b className="green">{c.total}</b></div>
                  </div>
                </div>
                <div className="dash-card-tag">{c.tag}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
    </div>
  )
}
