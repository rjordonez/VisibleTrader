import { Link, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { Home, Tag, Calculator, LogIn, LayoutDashboard } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { appUrl } from '../../lib/domains'

const ChevronDown = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ marginLeft: 3, flexShrink: 0 }}>
    <path d="M3 4.5l3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const tools = [
  { name: 'Live Ticker',       desc: 'Every qualifying Polymarket trade, live',      href: '/features/live-ticker', color: '#38bdf8' },
  { name: 'Vetted Picks',      desc: 'Capital-weighted conviction from top wallets', href: '/features/vetted-picks', color: '#10b981' },
  { name: 'Leaderboard',       desc: 'Real, verified win rate per wallet',           href: '/features/leaderboard', color: '#a78bfa' },
  { name: 'Profits',           desc: 'Payout-adjusted P&L, resolved and open',       href: '/features/profits',     color: '#fb923c' },
  { name: 'Alerts',            desc: 'Browser alerts on your watchlist',             href: '/features/alerts',      color: '#2dd4bf' },
  { name: 'Settings',          desc: 'Configure roster size and conviction tiers',   href: '/features/settings',    color: '#818cf8' },
]

const calculators = [
  { name: 'EV Calculator',        desc: 'Calculate expected value of any contract',       href: '/calculators', color: '#818cf8' },
  { name: 'Arbitrage Calculator', desc: 'Find guaranteed profit between two prices',      href: '/calculators', color: '#10b981' },
  { name: 'Kelly Criterion',      desc: 'Optimal bet sizing based on your edge',          href: '/calculators', color: '#38bdf8' },
  { name: 'Odds Converter',       desc: 'Convert between decimal, American, and prob',    href: '/calculators', color: '#fb923c' },
  { name: 'No-Vig Calculator',    desc: 'Strip the vig and find true market probability', href: '/calculators', color: '#f472b6' },
]

function DropdownSection({ label, items }: { label: string; items: typeof tools }) {
  return (
    <div className="nav-dropdown">
      <div className="nav-dropdown-label">{label}</div>
      <div className="nav-dropdown-grid">
        {items.map(t => (
          <a key={t.name} href={t.href} className="nav-dropdown-item">
            <span className="nav-dropdown-dot" style={{ background: t.color }} />
            <span>
              <div className="nav-dropdown-name">{t.name}</div>
              <div className="nav-dropdown-desc">{t.desc}</div>
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}

export default function Navbar() {
  const [signedIn, setSignedIn] = useState(false)
  const location = useLocation()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(!!session))
    return () => sub.subscription.unsubscribe()
  }, [])

  return (
    <>
      <nav className="nav">
        <div className="nav-left">
          <Link to="/" className="nav-logo">VisibleTrader.com</Link>

          <ul className="nav-links">
            <li className="nav-dropdown-wrap">
              <span className="nav-link-with-chevron">Tools <ChevronDown /></span>
              <DropdownSection label="For Prediction Markets" items={tools} />
            </li>
            <li><Link to="/pricing">Pricing</Link></li>
            <li className="nav-dropdown-wrap">
              <span className="nav-link-with-chevron">Resources <ChevronDown /></span>
              <DropdownSection label="Free Calculators" items={calculators} />
            </li>
          </ul>
        </div>

        <div className="nav-actions">
          {signedIn ? (
            <a href={appUrl('/')} className="btn-primary">Go to app</a>
          ) : (
            <a href={appUrl('/login')} className="btn-primary">Log in</a>
          )}
        </div>
      </nav>

      {/* Mobile-only bottom tab bar (see .nav-bottom in landing.css) —
          replaces the old hamburger + slide-in drawer. Flat icon tabs
          instead of the desktop's nested Tools/Resources dropdowns, since
          those don't have a single landing destination of their own. */}
      <nav className="nav-bottom">
        <Link to="/" className={`nav-bottom-item ${location.pathname === '/' ? 'active' : ''}`}>
          <Home size={20} />
          <span>Home</span>
        </Link>
        <Link to="/pricing" className={`nav-bottom-item ${location.pathname === '/pricing' ? 'active' : ''}`}>
          <Tag size={20} />
          <span>Pricing</span>
        </Link>
        <Link to="/calculators" className={`nav-bottom-item ${location.pathname === '/calculators' ? 'active' : ''}`}>
          <Calculator size={20} />
          <span>Calculators</span>
        </Link>
        {signedIn ? (
          <a href={appUrl('/')} className="nav-bottom-item">
            <LayoutDashboard size={20} />
            <span>Dashboard</span>
          </a>
        ) : (
          <a href={appUrl('/login')} className="nav-bottom-item">
            <LogIn size={20} />
            <span>Log in</span>
          </a>
        )}
      </nav>
    </>
  )
}
