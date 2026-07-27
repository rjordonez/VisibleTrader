import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-top">
          <div className="footer-brand">
            <a href="/" className="nav-logo" style={{ marginBottom: '0.5rem', display: 'inline-flex' }}>
              Venter
            </a>
            <p>
              Real-time tracking of Polymarket's top-performing wallets.
              See what's actually being bought, by whom, the moment it happens.
            </p>
            <div className="footer-socials">
              <a href="#" className="social-btn" aria-label="X / Twitter">
                <img src="/x-logo.jpg" alt="X" style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'cover' }} />
              </a>
              <a href="#" className="social-btn" aria-label="Discord">
                <img src="/discord.png" alt="Discord" style={{ width: 40, height: 40, borderRadius: 10, objectFit: 'contain' }} />
              </a>
            </div>
          </div>

          <div className="footer-col">
            <h5>Tools</h5>
            <ul>
              <li><Link to="/features/live-ticker">Live Ticker</Link></li>
              <li><Link to="/features/vetted-picks">Vetted Picks</Link></li>
              <li><Link to="/features/leaderboard">Leaderboard</Link></li>
              <li><Link to="/features/profits">Profits</Link></li>
              <li><Link to="/features/alerts">Alerts</Link></li>
              <li><Link to="/features/settings">Settings</Link></li>
            </ul>
          </div>

          <div className="footer-col">
            <h5>Calculators</h5>
            <ul>
              <li><Link to="/calculators">EV Calculator</Link></li>
              <li><Link to="/calculators">Arbitrage Calculator</Link></li>
              <li><Link to="/calculators">Kelly Criterion</Link></li>
              <li><Link to="/calculators">Odds Converter</Link></li>
              <li><Link to="/calculators">No-Vig Calculator</Link></li>
            </ul>
          </div>

          <div className="footer-col">
            <h5>Company</h5>
            <ul>
              <li><Link to="/pricing">Pricing</Link></li>
              <li><a href="/#faq">FAQ</a></li>
              <li><a href="/#tools">Features</a></li>
              <li><a href="#">Privacy</a></li>
              <li><a href="#">Terms</a></li>
            </ul>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© 2026 Venter, Inc. All rights reserved. 18+</p>
          <p>Prediction markets involve financial risk. Trade responsibly.</p>
        </div>

        <p className="footer-legal">
          Venter is a trade-tracking and analytics tool. It does not execute trades on your behalf and is not
          a registered investment or trading adviser. Past performance of tracked wallets is not indicative of
          future results. Individual outcomes vary. Please trade responsibly.
        </p>
      </div>
    </footer>
  )
}
