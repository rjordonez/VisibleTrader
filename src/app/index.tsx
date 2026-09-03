import { useState, useEffect, useRef, Suspense, lazy } from 'react'
import { Routes, Route, Navigate, Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Home as HomeIcon, Zap, TrendingUp, Trophy, Bell, Search } from 'lucide-react'
import { supabase, isProdDb } from '../lib/supabase'
import { dashboardPath } from '../lib/domains'
import { useSubscriptionGate } from '../lib/subscriptionGate'
import { useAlerts } from './useAlerts'
import { timeAgo } from './helpers'
import type { User } from '@supabase/supabase-js'
import './app.css'

// Lazy — each tab (plus whatever it pulls in, recharts in particular) only
// downloads once someone actually visits it, instead of every tab's code
// shipping together in one chunk the moment AppShell itself loads. See
// App.tsx's identical reasoning for the marketing/app split this mirrors.
const SignalsDemo = lazy(() => import('./SignalsDemo'))
const HomePage = lazy(() => import('./HomePage'))
const ProfitsPage = lazy(() => import('./ProfitsPage'))
const LeaderboardPage = lazy(() => import('./LeaderboardPage'))
const TraderDetailPage = lazy(() => import('./TraderDetailPage'))
const AlertsPage = lazy(() => import('./AlertsPage'))
const SettingsPage = lazy(() => import('./SettingsPage'))
const LookupPage = lazy(() => import('./LookupPage'))

function TabLoading() {
  return <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-3, #6b7280)', fontSize: '0.875rem' }}>Loading…</div>
}

// Alerts intentionally isn't in here — it's reachable via the header bell
// (see AlertsBell below) instead of a plain nav link, same reasoning as
// the Terminal's own read-only Alerts tab: it's a notification surface,
// not a page you navigate to browse.
const navItems = [
  { id: 'home',        label: 'Home',        path: '/',            Icon: HomeIcon },
  { id: 'signals',     label: 'Signals',     path: '/signals',     Icon: Zap },
  { id: 'profits',     label: 'Profits',     path: '/profits',     Icon: TrendingUp },
  { id: 'leaderboard', label: 'Leaderboard', path: '/leaderboard', Icon: Trophy },
  { id: 'lookup',      label: 'Lookup',      path: '/lookup',      Icon: Search },
]

// Wraps TraderDetailPage so it can live at a real /trader/:wallet URL —
// wallet addresses are plain hex, safe unencoded in a path segment.
// navigate(-1) reproduces the old "back returns to whichever tab you
// came from" behavior via normal browser history, and as a side effect
// this URL is now directly linkable/shareable, which it wasn't before.
function TraderDetailRoute() {
  const { wallet } = useParams<{ wallet: string }>()
  if (!wallet) return <Navigate to={dashboardPath('/')} replace />
  return <TraderDetailPage key={wallet} wallet={wallet} />
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
  const [alertsOpen, setAlertsOpen] = useState(false)
  const alertsRef = useRef<HTMLDivElement>(null)
  // Owned here (not by AlertsPage) so it keeps running regardless of which
  // tab is active — see useAlerts.ts. Both the bell's preview dropdown and
  // the full /alerts page read from this one instance.
  const alerts = useAlerts()

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUser(data.user ?? null))
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })
    return () => sub.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!userMenuOpen && !alertsOpen) return
    const onClickOutside = (e: MouseEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) setUserMenuOpen(false)
      if (alertsRef.current && !alertsRef.current.contains(e.target as Node)) setAlertsOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [userMenuOpen, alertsOpen])

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

          {user && (
            <div className="app-header-actions">
              <div className="app-alerts-menu" ref={alertsRef}>
                <button
                  type="button"
                  className="app-bell-btn"
                  onClick={() => setAlertsOpen(o => !o)}
                  aria-label="Alerts"
                >
                  <Bell size={18} />
                  {alerts.history.length > 0 && (
                    <span className="app-bell-badge">{alerts.history.length > 9 ? '9+' : alerts.history.length}</span>
                  )}
                </button>
                {alertsOpen && (
                  <div className="app-alerts-dropdown">
                    <div className="app-alerts-dropdown-title">Alerts</div>
                    {alerts.history.length === 0 ? (
                      <div className="app-alerts-dropdown-empty">No alerts yet.</div>
                    ) : (
                      alerts.history.slice(0, 5).map(h => (
                        <div key={h.id} className="app-alerts-dropdown-item">
                          <div className="app-alerts-dropdown-text">{h.text}</div>
                          <div className="app-alerts-dropdown-time">{timeAgo(new Date(h.ts).toISOString())}</div>
                        </div>
                      ))
                    )}
                    <Link
                      to={dashboardPath('/alerts')}
                      className="app-alerts-dropdown-showall"
                      onClick={() => setAlertsOpen(false)}
                    >
                      Show all
                    </Link>
                  </div>
                )}
              </div>

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
            </div>
          )}
        </div>
      </header>

      {/* Mobile-only fixed bottom tab bar — replaces the old hamburger +
          slide-in drawer. Settings/sign-out stay in the avatar dropdown
          above, not duplicated down here. Profits dropped from this row
          (still reachable from the desktop nav) to keep it to 4 items on
          the narrower mobile width; Alerts is the header bell instead,
          same as desktop. */}
      <nav className="app-mobile-nav-bottom">
        {navItems.filter(({ id }) => id !== 'profits').map(({ id, label, path, Icon }) => {
          const target = dashboardPath(path)
          return (
            <Link
              key={id}
              to={target}
              className={`app-mobile-nav-bottom-item ${location.pathname === target ? 'active' : ''}`}
            >
              <Icon size={20} />
              <span>{label}</span>
            </Link>
          )
        })}
      </nav>

      <main className={`app-main ${locked ? 'app-main-locked' : ''}`}>
        <div className={locked ? 'search-locked-bg' : undefined}>
          <Suspense fallback={<TabLoading />}>
            <Routes>
              <Route index element={<HomePage onOpenSignals={() => navigate(dashboardPath('/signals'))} category={category} onCategoryChange={setCategory} />} />
              <Route path="signals" element={<SignalsDemo category={category} onCategoryChange={setCategory} />} />
              <Route path="profits" element={<ProfitsPage />} />
              <Route path="leaderboard" element={<LeaderboardPage />} />
              <Route path="alerts" element={<AlertsPage {...alerts} />} />
              <Route path="lookup" element={<LookupPage />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="trader/:wallet" element={<TraderDetailRoute />} />
              <Route path="*" element={<Navigate to={dashboardPath('/')} replace />} />
            </Routes>
          </Suspense>
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
