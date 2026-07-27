import { Radar, TrendingUp, BarChart2, Bell, Settings, Activity, Landmark } from 'lucide-react'

const navIcons = [Radar, TrendingUp, BarChart2, Bell, Settings]

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
        <div className="chrome-bar">app.visibletrader.io/signals</div>
        <div className="chrome-spacer" />
      </div>

      {/* Dashboard body */}
      <div className="dashboard-body">
        {/* Sidebar */}
        <div className="dash-sidebar">
          {['Signals', 'Profits', 'Leaderboard', 'Alerts', 'Settings'].map((item, i) => {
            const NavIcon = navIcons[i]
            return (
              <div key={item} className={`dash-nav-item ${i === 0 ? 'active' : ''}`}>
                <span className="dash-nav-icon"><NavIcon size={13} /></span>
                {item}
              </div>
            )
          })}
        </div>

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
