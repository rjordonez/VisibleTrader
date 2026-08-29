import PhoneOverlay from './PhoneOverlay'

// Illustrative only — this whole component is a static marketing mockup of
// the Winners tab (fake traders, fake markets, fake everything above), not
// a view onto real user or trading data. Same rule as the old
// DashboardPreview this replaced: never wired to a real fetch. Mirrors the
// real app's Winners tab (src/app/SignalsDemo.tsx + .lb-* in app.css)
// visually, but stays its own self-contained styling (see .wp-* in
// landing.css) — landing/ and app/ are a deliberately enforced boundary
// (see .dependency-cruiser.cjs), so this can never actually import it.
const navItems = ['Home', 'Signals', 'Profits', 'Leaderboard', 'Alerts', 'Lookup']

const rows = [
  { initial: 'C', bg: 'linear-gradient(135deg, #ca8a04, #facc15)', name: 'coinwatcher92', status: 'Won', time: '12s ago', market: 'Will the Fed cut rates in September?', outcome: 'Yes', pnl: '+$62,340', pct: '71.2%', staked: '$87,550', legs: '1 leg' },
  { initial: '0', bg: 'linear-gradient(135deg, #9333ea, #c084fc)', name: '0x4Ab9…e21c', status: 'Won', time: '48s ago', market: 'Lakers vs. Warriors', outcome: 'Lakers', pnl: '+$18,920', pct: '44.6%', staked: '$42,400', legs: '1 leg' },
  { initial: 'N', bg: 'linear-gradient(135deg, #0891b2, #22d3ee)', name: 'nightowl77', status: 'Exited', time: '1m ago', market: 'Will Bitcoin close above $130k in August?', outcome: 'Yes', pnl: '+$9,410', pct: '22.8%', staked: '$41,280', legs: '2 legs' },
  { initial: 'F', bg: 'linear-gradient(135deg, #dc2626, #f87171)', name: 'ferrariFan22', status: 'Scalped', time: '2m ago', market: 'Chelsea vs. Arsenal', outcome: 'Draw', pnl: '+$3,150', pct: '9.1%', staked: '$34,615', legs: '1 leg' },
  { initial: 'Q', bg: 'linear-gradient(135deg, #1e8f0d, #56ab4a)', name: 'quietrisk', status: 'Won', time: '3m ago', market: 'Will there be a government shutdown by Oct 1?', outcome: 'No', pnl: '+$1,204', pct: '3.6%', staked: '$33,890', legs: '1 leg' },
  { initial: 'B', bg: 'linear-gradient(135deg, #db2777, #f472b6)', name: 'bertapotamous', status: 'Won', time: '4m ago', market: 'Will Ethereum flip $5k before October?', outcome: 'Yes', pnl: '+$27,880', pct: '38.4%', staked: '$72,610', legs: '1 leg' },
  { initial: 'T', bg: 'linear-gradient(135deg, #0891b2, #22d3ee)', name: 'tourists44', status: 'Exited', time: '5m ago', market: 'Real Madrid vs. Real Sociedad', outcome: 'Real Madrid', pnl: '+$5,930', pct: '17.2%', staked: '$34,480', legs: '1 leg' },
  { initial: '0', bg: 'linear-gradient(135deg, #9333ea, #c084fc)', name: '0xE30e…4f1B', status: 'Won', time: '7m ago', market: 'Will James Fishback be the GOP nominee?', outcome: 'No', pnl: '+$2,410', pct: '6.1%', staked: '$39,720', legs: '1 leg' },
  { initial: 'S', bg: 'linear-gradient(135deg, #ca8a04, #facc15)', name: 'sworksdegen', status: 'Won', time: '8m ago', market: 'Will inflation come in under 3% for August?', outcome: 'Yes', pnl: '+$14,205', pct: '52.9%', staked: '$26,850', legs: '2 legs' },
  { initial: 'W', bg: 'linear-gradient(135deg, #1e8f0d, #56ab4a)', name: 'wordleaddict', status: 'Scalped', time: '9m ago', market: 'Yankees vs. Red Sox', outcome: 'Yankees', pnl: '+$3,860', pct: '11.4%', staked: '$33,910', legs: '1 leg' },
]

export default function WinnersPreview() {
  return (
    <div className="dashboard-container">
      <div className="device-glow" />
      <div className="monitor-frame">
        <div className="monitor-camera" />
        <div className="monitor-screen">
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
          <div className="dash-main">
            <div className="dash-topbar">
              <div>
                <div className="dash-title">Winners</div>
                <div className="dash-subtitle">Closed, profitable positions from tracked wallets</div>
              </div>
            </div>

            <div className="wp-table">
              <div className="wp-head">
                <div>Trader</div>
                <div>Market</div>
                <div className="wp-col">PnL</div>
                <div className="wp-col">Staked</div>
              </div>
              {rows.map((r, i) => (
                <div className="wp-row" key={i}>
                  <div className="wp-trader">
                    <div className="wp-avatar" style={{ background: r.bg }}>{r.initial}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="wp-name">{r.name}</div>
                      <div className="wp-sub">{r.status} · {r.time}</div>
                    </div>
                  </div>
                  <div className="wp-market">{r.market} <span>— {r.outcome}</span></div>
                  <div className="wp-col">
                    <div className="wp-val g">{r.pnl}</div>
                    <div className="wp-val-sub g">▲ {r.pct}</div>
                  </div>
                  <div className="wp-col">
                    <div className="wp-val">{r.staked}</div>
                    <div className="wp-val-sub">{r.legs}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      </div>
      </div>
      <div className="monitor-stand-neck" />
      <div className="monitor-stand-base" />
      <div className="device-phone-overlay">
        <PhoneOverlay />
      </div>
    </div>
  )
}
