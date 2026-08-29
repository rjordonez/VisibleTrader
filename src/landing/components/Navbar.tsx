import { Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { appUrl } from '../../lib/domains'

const ChevronDown = () => (
  <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ marginLeft: 3, flexShrink: 0 }}>
    <path d="M3 4.5l3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
)

const calculators = [
  { name: 'EV Calculator',        desc: 'Calculate expected value of any contract',       href: '/calculators', color: '#818cf8' },
  { name: 'Arbitrage Calculator', desc: 'Find guaranteed profit between two prices',      href: '/calculators', color: '#10b981' },
  { name: 'Kelly Criterion',      desc: 'Optimal bet sizing based on your edge',          href: '/calculators', color: '#38bdf8' },
  { name: 'Odds Converter',       desc: 'Convert between decimal, American, and prob',    href: '/calculators', color: '#fb923c' },
  { name: 'No-Vig Calculator',    desc: 'Strip the vig and find true market probability', href: '/calculators', color: '#f472b6' },
]

type Menu = 'closed' | 'main'

function DropdownSection({ label, items }: { label: string; items: typeof calculators }) {
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
  const [menu, setMenu] = useState<Menu>('closed')
  const [signedIn, setSignedIn] = useState(false)

  useEffect(() => {
    document.body.style.overflow = menu !== 'closed' ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [menu])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSignedIn(!!data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => setSignedIn(!!session))
    return () => sub.subscription.unsubscribe()
  }, [])

  const close = () => setMenu('closed')

  return (
    <>
      <nav className="nav">
        <div className="nav-left">
          <Link to="/" className="nav-logo">VisibleTrader.com</Link>

          <ul className="nav-links">
            <li><Link to="/pricing">Pricing</Link></li>
            <li className="nav-dropdown-wrap">
              <span className="nav-link-with-chevron">Resources <ChevronDown /></span>
              <DropdownSection label="Calculators" items={calculators} />
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

        <button className="nav-hamburger" onClick={() => setMenu('main')} aria-label="Open menu">
          <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
            <path d="M3 6h16M3 11h16M3 16h16" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"/>
          </svg>
        </button>
      </nav>

      <div className={`nav-overlay ${menu !== 'closed' ? 'open' : ''}`} onClick={close} />

      <div className={`nav-drawer ${menu !== 'closed' ? 'open' : ''}`}>
        {menu === 'main' && (
          <>
            <div className="nav-drawer-header">
              <Link to="/" className="nav-logo" onClick={close}>VisibleTrader.com</Link>
              <button className="nav-drawer-close" onClick={close}>✕</button>
            </div>
            <div className="nav-drawer-body">
              {signedIn ? (
                <a href={appUrl('/')} className="nav-drawer-cta" onClick={close}>Go to app</a>
              ) : (
                <>
                  <a href={appUrl('/login')} className="nav-drawer-link" onClick={close}>Log in</a>
                  <Link to="/pricing" className="nav-drawer-cta" onClick={close}>Get Started</Link>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </>
  )
}
