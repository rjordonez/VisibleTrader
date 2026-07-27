const rows = [
  { market: 'Arizona Diamondbacks vs. Washington Nationals', wallets: 9, total: '$91,947', price: '53¢', tag: 'Sports' },
  { market: 'US x Iran Effective Ceasefire by July 24?',     wallets: 5, total: '$2,179',  price: '15¢', tag: 'Politics' },
  { market: 'Will CF América win on 2026-07-24?',            wallets: 6, total: '$21,160', price: '71¢', tag: 'Sports' },
]

export default function DashboardPreview() {
  return (
    <div className="dashboard-container">
    <div className="dashboard-wrap">
      {/* Browser chrome */}
      <div className="dashboard-chrome">
        <div className="chrome-dots">
          <span /><span /><span />
        </div>
        <div className="chrome-bar">app.venter.io/signals</div>
        <div className="chrome-spacer" />
      </div>

      {/* Dashboard body */}
      <div className="dashboard-body">
        {/* Sidebar */}
        <div className="dash-sidebar">
          {['Signals', 'Profits', 'Leaderboard', 'Alerts', 'Settings'].map((item, i) => (
            <div key={item} className={`dash-nav-item ${i === 0 ? 'active' : ''}`}>
              <span className="dash-nav-icon">
                {['📡','📈','🏆','🔔','⚙️'][i]}
              </span>
              {item}
            </div>
          ))}
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

          <table className="dash-table">
            <thead>
              <tr>
                <th>Market</th>
                <th>Top Traders</th>
                <th>Price</th>
                <th>Total $</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>
                    <div className="dash-market-name">{r.market}</div>
                    <span className="dash-tag">{r.tag}</span>
                  </td>
                  <td className="dash-price">{r.wallets}</td>
                  <td className="dash-price">{r.price}</td>
                  <td className="dash-ev">{r.total}</td>
                  <td>
                    <button className="dash-bet-btn">View →</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
    </div>
  )
}
