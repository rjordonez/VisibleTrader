import { useState, useEffect, useRef, Suspense, lazy } from 'react'
import { Routes, Route, Navigate, Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Home as HomeIcon, Zap, TrendingUp, Trophy, Bell, ChevronLeft, ChevronRight, ChevronDown, HelpCircle, CalendarDays, Menu, X } from 'lucide-react'
import { supabase, isProdDb } from '../lib/supabase'
import { dashboardPath } from '../lib/domains'
import { useSubscriptionGate } from '../lib/subscriptionGate'
import { useAlerts } from './useAlerts'
import GlobalSearch from './GlobalSearch'
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
const JournalPage = lazy(() => import('./JournalPage'))

// Self-contained (own state/ref/outside-click handling) rather than driven
// by AppShell-level state, specifically so it can be mounted twice — once
// in the top bar, once pinned to the bottom of the sidebar — without both
// instances opening/closing together the way sharing one boolean would.
function UserMenu({ user, settingsPath, signOut, expanded = false }: {
  user: User
  settingsPath: string
  signOut: () => void
  // Avatar + name + chevron (sidebar-bottom placement) vs. just the bare
  // avatar circle (top-bar placement, where horizontal space is tighter).
  expanded?: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Account'

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  return (
    <div className="app-user-menu" ref={ref}>
      <button
        type="button"
        className={`app-avatar-btn ${expanded ? 'app-avatar-btn-expanded' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-label="Account menu"
      >
        <span className="app-avatar">{(user.email ?? '?')[0].toUpperCase()}</span>
        {isProdDb && <span className="app-prod-dot" title="Connected to production data" />}
        {expanded && (
          <>
            <span className="app-avatar-name">{displayName}</span>
            <ChevronDown size={14} className="app-avatar-chevron" />
          </>
        )}
      </button>
      {open && (
        <div className="app-user-dropdown">
          <Link
            to={settingsPath}
            className="app-user-dropdown-item"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>
          <button className="app-user-dropdown-item danger" onClick={signOut}>Sign out</button>
        </div>
      )}
    </div>
  )
}

// Same reasoning as UserMenu — own state so this can be mounted twice
// (sidebar + the compact mobile top bar) without one instance's open/
// closed state fighting the other's.
function AlertsBell({ alerts }: { alerts: ReturnType<typeof useAlerts> }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [open])

  return (
    <div className="app-alerts-menu" ref={ref}>
      <button
        type="button"
        className="app-bell-btn"
        onClick={() => setOpen(o => !o)}
        aria-label="Alerts"
      >
        <Bell size={18} />
        {alerts.history.length > 0 && (
          <span className="app-bell-badge">{alerts.history.length > 9 ? '9+' : alerts.history.length}</span>
        )}
      </button>
      {open && (
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
            onClick={() => setOpen(false)}
          >
            Show all
          </Link>
        </div>
      )}
    </div>
  )
}

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
]

// Own group, own section label — separate from the tracked-wallet pages
// above since this is the user's own self-reported data, not anything the
// live-signal-service computes. Left out of the mobile bottom tab bar
// (same treatment Profits already gets there) to keep that row to 3 items;
// still reachable from the sidebar/desktop.
const personalNavItems = [
  { id: 'journal', label: 'Journal', path: '/journal', Icon: CalendarDays },
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
  // Persisted so the choice sticks across reloads/sessions, same pattern as
  // useAlerts.ts's localStorage-backed watchlist/tier state.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('vt_sidebar_collapsed') === '1')
  useEffect(() => { localStorage.setItem('vt_sidebar_collapsed', sidebarCollapsed ? '1' : '0') }, [sidebarCollapsed])
  // Mobile-only — the sidebar itself becomes an off-canvas drawer there
  // (see .app-sidebar's 768px override) instead of morphing into a top
  // bar, so this just slides it in/out; .app-main is never touched by it,
  // which is the whole point (a pure overlay, not a layout push).
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  useEffect(() => { setMobileNavOpen(false) }, [location.pathname])
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

  const signOut = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  const settingsPath = dashboardPath('/settings')

  return (
    <div className={`app-shell ${sidebarCollapsed ? 'app-sidebar-collapsed' : ''} ${mobileNavOpen ? 'app-mobile-nav-open' : ''}`}>
      {/* Compact mobile-only top bar — separate element from .app-sidebar
          now that the sidebar is a genuine off-canvas drawer (see its
          768px override below) rather than morphing into this bar itself.
          Own Search/Bell/Avatar instances, same reasoning as AlertsBell/
          UserMenu being reusable: independent state from the sidebar's
          copies so neither fights the other over one open flag. */}
      <div className="app-mobile-topbar">
        <button
          type="button"
          className="app-mobile-menu-btn"
          onClick={() => setMobileNavOpen(true)}
          aria-label="Open menu"
        >
          <Menu size={20} />
          <span>Menu</span>
        </button>
        {user && (
          <div className="app-mobile-topbar-actions">
            <AlertsBell alerts={alerts} />
            <UserMenu user={user} settingsPath={settingsPath} signOut={signOut} />
          </div>
        )}
      </div>

      {mobileNavOpen && (
        <div className="app-mobile-drawer-backdrop" onClick={() => setMobileNavOpen(false)} />
      )}

      <aside className="app-sidebar">
        <div className="app-sidebar-inner">
          <div className="app-sidebar-brand-row">
            <div className="app-header-logo">
              <span className="app-logo-full">VisibleTrader.com</span>
              <span className="app-logo-short">VT</span>
            </div>
            <button
              type="button"
              className="app-sidebar-collapse-btn"
              onClick={() => setSidebarCollapsed(c => !c)}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand' : 'Collapse'}
            >
              {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
            </button>
            <button
              type="button"
              className="app-mobile-drawer-close"
              onClick={() => setMobileNavOpen(false)}
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
          </div>
          {user && <div className="app-sidebar-search"><GlobalSearch label="Search" /></div>}
          <nav className="app-sidebar-nav">
            {navItems.map(({ id, label, path, Icon }) => {
              const target = dashboardPath(path)
              return (
                <Link
                  key={id}
                  to={target}
                  title={label}
                  className={`app-nav-item ${location.pathname === target ? 'active' : ''}`}
                >
                  <Icon size={17} />
                  <span className="app-nav-label">{label}</span>
                </Link>
              )
            })}

            <div className="app-nav-section-label">Personal</div>
            {personalNavItems.map(({ id, label, path, Icon }) => {
              const target = dashboardPath(path)
              return (
                <Link
                  key={id}
                  to={target}
                  title={label}
                  className={`app-nav-item ${location.pathname === target ? 'active' : ''}`}
                >
                  <Icon size={17} />
                  <span className="app-nav-label">{label}</span>
                </Link>
              )
            })}
          </nav>

          {/* Second UserMenu instance — same component, independent state
              from the one in .app-sidebar-actions below, so this can sit at
              the bottom of the rail without the two fighting over one open/
              closed flag. */}
          {user && (
            <div className="app-sidebar-bottom-user">
              <a
                href="mailto:visibletradehq@gmail.com"
                title="Help"
                className="app-nav-item app-sidebar-help"
              >
                <HelpCircle size={17} />
                <span className="app-nav-label">Help</span>
              </a>
              <UserMenu user={user} settingsPath={settingsPath} signOut={signOut} expanded={!sidebarCollapsed} />
            </div>
          )}

          {user && (
            <div className="app-sidebar-actions">
              <div className="app-sidebar-actions-row">
                <AlertsBell alerts={alerts} />
                <UserMenu user={user} settingsPath={settingsPath} signOut={signOut} />
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className={`app-main ${locked ? 'app-main-locked' : ''}`}>
        <div className={locked ? 'search-locked-bg' : undefined}>
          <Suspense fallback={<TabLoading />}>
            <Routes>
              <Route index element={<HomePage user={user} />} />
              <Route path="signals" element={<SignalsDemo category={category} onCategoryChange={setCategory} />} />
              <Route path="profits" element={<ProfitsPage />} />
              <Route path="leaderboard" element={<LeaderboardPage />} />
              <Route path="alerts" element={<AlertsPage {...alerts} />} />
              <Route path="settings" element={<SettingsPage />} />
              <Route path="journal" element={<JournalPage />} />
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
