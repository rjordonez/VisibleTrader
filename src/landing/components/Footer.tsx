import { Link } from 'react-router-dom'

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="footer-top">
          <div className="footer-brand">
            <a href="/" className="nav-logo" style={{ marginBottom: '0.5rem', display: 'inline-flex' }}>
              VisibleTrader
            </a>
            <p>
              The #1 Whale Tracker To Beat Prediction Markets
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

          <div className="footer-cols">
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
                <li><Link to="/blog">Blog</Link></li>
                <li><Link to="/careers">Careers</Link></li>
                <li><Link to="/affiliates">Affiliates</Link></li>
              </ul>
            </div>

            <div className="footer-col">
              <h5>Legal</h5>
              <ul>
                <li><Link to="/privacy">Privacy Policy</Link></li>
                <li><Link to="/terms">Terms of Service</Link></li>
                <li><Link to="/refund-policy">Refund Policy</Link></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <p>© 2026 VisibleTrader, Inc. All rights reserved. 18+</p>
          <p>Prediction markets involve financial risk. Trade responsibly.</p>
        </div>

        <p className="footer-legal">
          VisibleTrader is a trade-tracking and analytics tool. It does not execute trades on your behalf and is not
          a registered investment or trading adviser. Past performance of tracked wallets is not indicative of
          future results. Individual outcomes vary. Please trade responsibly.
        </p>
      </div>
    </footer>
  )
}
