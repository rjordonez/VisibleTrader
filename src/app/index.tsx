import { useState, useEffect, useRef } from 'react'
import { Routes, Route, Navigate, Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase, isProdDb } from '../lib/supabase'
import { dashboardPath } from '../lib/domains'
import { useSubscriptionGate } from '../lib/subscriptionGate'
import type { User } from '@supabase/supabase-js'
import SignalsDemo from './SignalsDemo'
import HomePage from './HomePage'
import ProfitsPage from './ProfitsPage'
import LeaderboardPage from './LeaderboardPage'
import TraderDetailPage from './TraderDetailPage'
import AlertsPage from './AlertsPage'
import SettingsPage from './SettingsPage'
import LookupPage from './LookupPage'
import './app.css'

const navItems = [
  { id: 'home',        label: 'Home',        path: '/'            },
  { id: 'signals',     label: 'Signals',     path: '/signals'     },
  { id: 'profits',     label: 'Profits',     path: '/profits'     },
  { id: 'leaderboard', label: 'Leaderboard', path: '/leaderboard' },
  { id: 'alerts',      label: 'Alerts',      path: '/alerts'      },
  { id: 'lookup',      label: 'Lookup',      path: '/lookup'      },
]

// Wraps TraderDetailPage so it can live at a real /trader/:wallet URL —
// wallet addresses are plain hex, safe unencoded in a path segment.
// navigate(-1) reproduces the old "back returns to whichever tab you
// came from" behavior via normal browser history, and as a side effect
// this URL is now directly linkable/shareable, which it wasn't before.
function TraderDetailRoute() {
  const { wallet } = useParams<{ wallet: string }>()
  const navigate = useNavigate()
  if (!wallet) return <Navigate to={dashboardPath('/')} replace />
  return <TraderDetailPage key={wallet} wallet={wallet} onBack={() => navigate(-1)} />
}

/* ── App Shell ──
   The <Routes> below use relative paths (no leading slash, `index` for
   home) on purpose — this component is mounted by App.tsx at a wildcard
   route (`/*` in prod, `/app/*` in dev, since there's no real subdomain
   locally), and only relative child routes automatically resolve against
   however much of the URL that ancestor match already consumed. Absolute
   paths here would always match against the true root and silently break
   in dev, where the real URL carries a leading /app it can't see past.
   Anywhere this file navigates (Link/navigate), it goes through
   dashboardPath() instead, which adds that same /app prefix explicitly —
   see src/lib/domains.ts. */
export default function AppShell() {
  const navigate = useNavigate()
  const location = useLocation()
  const { locked } = useSubscriptionGate()
  const [user, setUser] = useState<User | null>(null)
  const [category, setCategory] = useState('all')
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const mobileNavRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userMenuOpen) return
    const onClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [userMenuOpen])

  useEffect(() => {
    if (!mobileNavOpen) return
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.closest('.app-mobile-nav-toggle')) return
      if (mobileNavRef.current && !mobileNavRef.current.contains(target)) setMobileNavOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [mobileNavOpen])

  const signOut = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const settingsPath = dashboardPath('/settings')

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-header-logo">VisibleTrader.com</div>
          <nav className="app-header-nav">
            {navItems.map(({ id, label, path }) => {
              const target = dashboardPath(path)
              return (
                <Link
                  key={id}
                  to={target}
                  className={`app-nav-item ${location.pathname === target ? 'active' : ''}`}
                >
                  {label}
                </Link>
              )
            })}
          </nav>

          <button
            type="button"
            className="app-mobile-nav-toggle"
            onClick={() => setMobileNavOpen(o => !o)}
            aria-label="Menu"
          >
            {mobileNavOpen ? '✕' : '☰'}
          </button>

          {user && (
            <div className="app-user-menu" ref={userMenuRef}>
              <button
                type="button"
                className="app-avatar-btn"
                onClick={() => setUserMenuOpen(o => !o)}
                aria-label="Account menu"
              >
                <span className="app-avatar">{(user.email ?? '?')[0].toUpperCase()}</span>
                {isProdDb && <span className="app-prod-dot" title="Connected to production data" />}
              </button>
              {userMenuOpen && (
                <div className="app-user-dropdown">
                  <Link
                    to={settingsPath}
                    className="app-user-dropdown-item"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    Settings
                  </Link>
                  <button className="app-user-dropdown-item danger" onClick={signOut}>Sign out</button>
                </div>
              )}
            </div>
          )}
        </div>

        {mobileNavOpen && (
          <nav className="app-mobile-nav" ref={mobileNavRef}>
            {navItems.map(({ id, label, path }) => {
              const target = dashboardPath(path)
              return (
                <Link
                  key={id}
                  to={target}
                  className={`app-mobile-nav-item ${location.pathname === target ? 'active' : ''}`}
                  onClick={() => setMobileNavOpen(false)}
                >
                  {label}
                </Link>
              )
            })}
            {user && (
              <>
                <div className="app-mobile-nav-divider" />
                <Link
                  to={settingsPath}
                  className={`app-mobile-nav-item ${location.pathname === settingsPath ? 'active' : ''}`}
                  onClick={() => setMobileNavOpen(false)}
                >
                  Settings
                </Link>
                <button className="app-mobile-nav-item danger" onClick={signOut}>Sign out</button>
              </>
            )}
          </nav>
        )}
      </header>

      <main className={`app-main ${locked ? 'app-main-locked' : ''}`}>
        <div className={locked ? 'search-locked-bg' : undefined}>
          <Routes>
            <Route index element={<HomePage onOpenSignals={() => navigate(dashboardPath('/signals'))} category={category} onCategoryChange={setCategory} />} />
            <Route path="signals" element={<SignalsDemo category={category} />} />
            <Route path="profits" element={<ProfitsPage />} />
            <Route path="leaderboard" element={<LeaderboardPage />} />
            <Route path="alerts" element={<AlertsPage />} />
            <Route path="lookup" element={<LookupPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="trader/:wallet" element={<TraderDetailRoute />} />
            <Route path="*" element={<Navigate to={dashboardPath('/')} replace />} />
          </Routes>
        </div>
        {locked && (
          <div className="search-glass-overlay">
            <p className="search-glass-title">Subscribe to unlock live signals, profits, and trader data</p>
            <Link to={dashboardPath('/pricing')} className="search-glass-btn">See plans</Link>
          </div>
        )}
      </main>
    </div>
  )
}
