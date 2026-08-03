import { useState, useEffect } from 'react'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, BarChart2, Bell, Radar, Settings, Search, Home } from 'lucide-react'
import { supabase, isProdDb } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'
import { categoryLabel } from './helpers'
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
  { id: 'home',        label: 'Home',         Icon: Home       },
  { id: 'signals',     label: 'Signals',     Icon: Radar      },
  { id: 'profits',     label: 'Profits',     Icon: TrendingUp },
  { id: 'leaderboard', label: 'Leaderboard', Icon: BarChart2  },
  { id: 'alerts',      label: 'Alerts',      Icon: Bell       },
  { id: 'lookup',      label: 'Lookup',      Icon: Search     },
  { id: 'settings',    label: 'Settings',    Icon: Settings   },
]

const demos: Record<string, () => ReactElement> = {
  profits:     ProfitsPage,
  alerts:      AlertsPage,
  settings:    SettingsPage,
}

// Fixed taxonomy (not derived from live data) since this now lives in the
// header nav, rendered before any page has fetched its own category counts.
const NAV_CATEGORIES = ['politics', 'sports', 'crypto', 'esports', 'finance', 'economics', 'tech', 'culture', 'weather', 'mentions']

/* ── App Shell ── */
export default function AppShell() {
  const navigate = useNavigate()
  const [active, setActive] = useState('home')
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [category, setCategory] = useState('all')

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

  let page: ReactElement
  if (selectedWallet) {
    page = <TraderDetailPage wallet={selectedWallet} onBack={() => setSelectedWallet(null)} />
  } else if (active === 'home') {
    page = <HomePage onOpenSignals={() => setActive('signals')} category={category} />
  } else if (active === 'signals') {
    page = <SignalsDemo category={category} />
  } else if (active === 'leaderboard') {
    page = <LeaderboardPage onSelectWallet={setSelectedWallet} />
  } else if (active === 'lookup') {
    page = <LookupPage onSelectWallet={setSelectedWallet} />
  } else {
    const Demo = demos[active]
    page = <Demo />
  }

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-header-logo">VisibleTrader</div>
          {isProdDb && <div className="app-prod-badge">⚠ PROD DATA</div>}
          <nav className="app-header-nav">
            {navItems.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={`app-nav-item ${active === id && !selectedWallet ? 'active' : ''}`}
                onClick={() => { setActive(id); setSelectedWallet(null) }}
              >
                <span className="app-nav-icon"><Icon size={15} strokeWidth={1.6} /></span>
                {label}
              </button>
            ))}

            <span className="app-nav-divider" />

            <button
              className={`app-nav-item app-nav-cat ${category === 'all' ? 'active' : ''}`}
              onClick={() => setCategory('all')}
            >
              All
            </button>
            {NAV_CATEGORIES.map(c => (
              <button
                key={c}
                className={`app-nav-item app-nav-cat ${category === c ? 'active' : ''}`}
                onClick={() => {
                  setCategory(c)
                  if (active !== 'home' && active !== 'signals') { setActive('home'); setSelectedWallet(null) }
                }}
              >
                {categoryLabel(c)}
              </button>
            ))}
          </nav>

          {user && (
            <div className="app-header-user">
              <div className="app-user-row">
                <div className="app-avatar">{(user.email ?? '?')[0].toUpperCase()}</div>
                <div className="app-user-name">{user.email}</div>
              </div>
              <button className="app-nav-item" style={{ color: '#f87171' }} onClick={signOut}>Sign out</button>
            </div>
          )}
        </div>
      </header>

      <main className="app-main">
        {page}
      </main>
    </div>
  )
}
