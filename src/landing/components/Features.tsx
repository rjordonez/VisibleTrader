import { Link } from 'react-router-dom'
import { useEffect } from 'react'

export default function Features() {
  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in-view'); observer.unobserve(e.target) } }),
      { threshold: 0.35 }
    )
    document.querySelectorAll('.bento-ev, .bento-alerts, .bento-port').forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [])
  return (
    <section className="section" id="tools">
      <div className="section-inner">
        <div style={{ marginBottom: '3rem' }}>
          <span className="section-tag">Tools</span>
          <h2 style={{ margin: '0 0 0.5rem' }}>Why VisibleTrader will<br />work for you</h2>
          <p className="section-sub" style={{ margin: 0 }}>
            Real on-chain trade data from Polymarket's top-performing wallets, surfaced live.
          </p>
        </div>

        <div className="bento-grid">

          {/* ── Live Ticker — large left ── */}
          <Link to="/features/live-ticker" className="bento-card bento-arb">
            <span className="bento-label bento-label-green">LIVE TICKER →</span>
            <h3 className="bento-title">Watch the tape, live</h3>
            <p className="bento-sub">Every qualifying trade from every tracked wallet, the moment it happens.</p>
            <div className="bento-mock bento-mock-arb">
              <div className="arb-row">
                <div className="arb-platform">
                  <img src="/polymarket.png" alt="Polymarket" className="arb-logo" />
                  <span>Arizona Diamondbacks</span>
                </div>
                <div className="arb-prices">
                  <span className="arb-yes">BUY 53¢</span>
                  <span className="arb-no">$91,947</span>
                </div>
              </div>
              <div className="arb-divider" />
              <div className="arb-row">
                <div className="arb-platform">
                  <img src="/polymarket.png" alt="Polymarket" className="arb-logo" />
                  <span>CF América</span>
                </div>
                <div className="arb-prices">
                  <span className="arb-yes">BUY 71¢</span>
                  <span className="arb-no">$21,160</span>
                </div>
              </div>
              <div className="arb-profit-row">
                <span className="arb-profit-label">Live opportunities now</span>
                <span className="arb-profit-value">286</span>
              </div>
            </div>
          </Link>
          <Link to="/features/vetted-picks" className="bento-card bento-ev">
            <span className="bento-label bento-label-purple">VETTED PICKS →</span>
            <h3 className="bento-title">Capital-weighted conviction</h3>
            <p className="bento-sub">When multiple top wallets pile into the same side, we rank it.</p>
            <div className="bento-mock bento-mock-ev">
              <div className="ev-row">
                <span className="ev-market">9 top traders — Diamondbacks</span>
                <span className="ev-badge">$91.9k</span>
              </div>
              <div className="ev-row">
                <span className="ev-market">6 top traders — CF América</span>
                <span className="ev-badge">$21.2k</span>
              </div>
              <div className="ev-row">
                <span className="ev-market">5 top traders — US x Iran</span>
                <span className="ev-badge">$2.2k</span>
              </div>
            </div>
          </Link>

          {/* ── Alerts — small left ── */}
          <Link to="/features/alerts" className="bento-card bento-alerts">
            <span className="bento-label bento-label-blue">ALERTS →</span>
            <h3 className="bento-title">Never miss a move</h3>
            <p className="bento-sub">Browser alerts the moment a wallet on your watchlist crosses a tier.</p>
            <div className="bento-mock bento-mock-alerts">
              <div className="alert-notif">
                <div className="alert-app-icon">V</div>
                <div className="alert-body">
                  <div className="alert-title-row">VisibleTrader Alert</div>
                  <div className="alert-text">🔥 Watched wallet crossed $20k tier</div>
                </div>
                <div className="alert-time">now</div>
              </div>
              <div className="alert-notif alert-notif-dim">
                <div className="alert-app-icon">V</div>
                <div className="alert-body">
                  <div className="alert-title-row">VisibleTrader Alert</div>
                  <div className="alert-text">New solo pick: US x Iran ceasefire</div>
                </div>
                <div className="alert-time">2m</div>
              </div>
            </div>
          </Link>

          <Link to="/features/leaderboard" className="bento-card bento-port">
            <span className="bento-label bento-label-teal">LEADERBOARD →</span>
            <h3 className="bento-title">Real, verified track records</h3>
            <p className="bento-sub">Win rate by trade count and by dollars deployed — not their claimed PnL.</p>
            <div className="bento-mock bento-mock-port">
              <div className="port-stats">
                <div className="port-stat">
                  <div className="port-stat-val green">64%</div>
                  <div className="port-stat-label">Win rate ($)</div>
                </div>
                <div className="port-stat">
                  <div className="port-stat-val">72%</div>
                  <div className="port-stat-label">Win rate (#)</div>
                </div>
                <div className="port-stat">
                  <div className="port-stat-val">500</div>
                  <div className="port-stat-label">Wallets tracked</div>
                </div>
              </div>
              <div className="port-chart">
                {[28, 42, 35, 55, 48, 70, 62, 88, 75, 95].map((h, i) => (
                  <div key={i} className="port-bar" style={{ height: `${h * 0.9}%` }} />
                ))}
              </div>
            </div>
          </Link>

          <Link to="/features/profits" className="bento-card bento-promo">
            <span className="bento-label bento-label-orange">PROFITS →</span>
            <h3 className="bento-title">Payout-adjusted P&L</h3>
            <p className="bento-sub">Real resolved profit and loss, mark-to-market on every open position.</p>
            <div className="bento-mock bento-mock-promo">
              <div className="promo-card">
                <div className="promo-platform">
                  <img src="/polymarket.png" alt="Polymarket" className="arb-logo" />
                  <span>Resolved positions, payout-adjusted</span>
                </div>
                <div className="promo-amount">Net P&L</div>
                <div className="promo-amount-label">not just win/loss count</div>
                <div className="promo-action">
                  <span className="promo-trade">Mark-to-market on open positions</span>
                  <span className="promo-ev-badge">Live ✓</span>
                </div>
              </div>
            </div>
          </Link>

          <Link to="/features/settings" className="bento-card bento-coach">
            <span className="bento-label bento-label-gray">CONFIGURABLE →</span>
            <h3 className="bento-title">Tune it to<br />your risk appetite.</h3>
            <p className="bento-sub">Set roster size, conviction tiers, and scalp windows — applied live, no restart.</p>
          </Link>

        </div>
      </div>
    </section>
  )
}
