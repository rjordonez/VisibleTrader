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
          <h2 style={{ margin: '0 0 0.5rem' }}>Why Venter will<br />work for you</h2>
          <p className="section-sub" style={{ margin: 0 }}>
            The tools that give you a real, repeatable edge in prediction markets.
          </p>
        </div>

        <div className="bento-grid">

          {/* ── Arbitrage — large left ── */}
          <Link to="/features/arbitrage" className="bento-card bento-arb">
            <span className="bento-label bento-label-green">ARBITRAGE →</span>
            <h3 className="bento-title">Bet both sides and win</h3>
            <p className="bento-sub">When platforms disagree, you lock in profit regardless of outcome.</p>
            <div className="bento-mock bento-mock-arb">
              <div className="arb-row">
                <div className="arb-platform">
                  <img src="/kalshi.png" alt="Kalshi" className="arb-logo" />
                  <span>Kalshi</span>
                </div>
                <div className="arb-prices">
                  <span className="arb-yes">YES 62¢</span>
                  <span className="arb-no">NO 41¢</span>
                </div>
              </div>
              <div className="arb-divider" />
              <div className="arb-row">
                <div className="arb-platform">
                  <img src="/polymarket.png" alt="Polymarket" className="arb-logo" />
                  <span>Polymarket</span>
                </div>
                <div className="arb-prices">
                  <span className="arb-yes">YES 57¢</span>
                  <span className="arb-no">NO 46¢</span>
                </div>
              </div>
              <div className="arb-profit-row">
                <span className="arb-profit-label">Guaranteed profit</span>
                <span className="arb-profit-value">+8.0%</span>
              </div>
            </div>
          </Link>
          <Link to="/features/ev" className="bento-card bento-ev">
            <span className="bento-label bento-label-purple">POSITIVE EV →</span>
            <h3 className="bento-title">Bet with a real edge</h3>
            <p className="bento-sub">We surface contracts where the crowd is systematically wrong.</p>
            <div className="bento-mock bento-mock-ev">
              <div className="ev-row">
                <span className="ev-market">Bitcoin above $120k by Aug?</span>
                <span className="ev-badge">+6.4%</span>
              </div>
              <div className="ev-row">
                <span className="ev-market">Fed cuts rates in July?</span>
                <span className="ev-badge">+9.1%</span>
              </div>
              <div className="ev-row">
                <span className="ev-market">Trump EO this week?</span>
                <span className="ev-badge">+7.8%</span>
              </div>
            </div>
          </Link>

          {/* ── Live Alerts — small left ── */}
          <Link to="/features/alerts" className="bento-card bento-alerts">
            <span className="bento-label bento-label-blue">MOBILE →</span>
            <h3 className="bento-title">Never miss a move</h3>
            <p className="bento-sub">Instant push alerts the moment a high-edge market opens.</p>
            <div className="bento-mock bento-mock-alerts">
              <div className="alert-notif">
                <div className="alert-app-icon">V</div>
                <div className="alert-body">
                  <div className="alert-title-row">Venter Alert</div>
                  <div className="alert-text">🔥 +11.2% ARB: Fed July cut</div>
                </div>
                <div className="alert-time">now</div>
              </div>
              <div className="alert-notif alert-notif-dim">
                <div className="alert-app-icon">V</div>
                <div className="alert-body">
                  <div className="alert-title-row">Venter Alert</div>
                  <div className="alert-text">+7.8% EV: Trump EO market</div>
                </div>
                <div className="alert-time">2m</div>
              </div>
            </div>
          </Link>

          <Link to="/features/portfolio" className="bento-card bento-port">
            <span className="bento-label bento-label-teal">PORTFOLIO →</span>
            <h3 className="bento-title">See your full edge</h3>
            <p className="bento-sub">Track ROI and realized profit across every platform in one place.</p>
            <div className="bento-mock bento-mock-port">
              <div className="port-stats">
                <div className="port-stat">
                  <div className="port-stat-val green">+$1,240</div>
                  <div className="port-stat-label">This month</div>
                </div>
                <div className="port-stat">
                  <div className="port-stat-val">+18.4%</div>
                  <div className="port-stat-label">ROI</div>
                </div>
                <div className="port-stat">
                  <div className="port-stat-val">38</div>
                  <div className="port-stat-label">Trades</div>
                </div>
              </div>
              <div className="port-chart">
                {[28, 42, 35, 55, 48, 70, 62, 88, 75, 95].map((h, i) => (
                  <div key={i} className="port-bar" style={{ height: `${h * 0.9}%` }} />
                ))}
              </div>
            </div>
          </Link>

          <Link to="/features/promo" className="bento-card bento-promo">
            <span className="bento-label bento-label-orange">PROMO OPTIMIZER →</span>
            <h3 className="bento-title">Maximize your bonuses</h3>
            <p className="bento-sub">Platforms offer sign-up bonuses. We extract every dollar of value.</p>
            <div className="bento-mock bento-mock-promo">
              <div className="promo-card">
                <div className="promo-platform">
                  <img src="/kalshi.png" alt="Kalshi" className="arb-logo" />
                  <span>Kalshi: Welcome Bonus</span>
                </div>
                <div className="promo-amount">$200</div>
                <div className="promo-amount-label">Bonus Value</div>
                <div className="promo-action">
                  <span className="promo-trade">Trade: Fed July cut YES @ 62¢</span>
                  <span className="promo-ev-badge">Extracted ✓</span>
                </div>
              </div>
            </div>
          </Link>

          <Link to="/pricing" className="bento-card bento-coach">
            <span className="bento-label bento-label-gray">FREE 1:1 →</span>
            <h3 className="bento-title">No experience?<br />No problem.</h3>
            <p className="bento-sub">Our coaches walk you through your first trades live.</p>
          </Link>

        </div>
      </div>
    </section>
  )
}
