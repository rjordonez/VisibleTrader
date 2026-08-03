import { useState, useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase, isProdDb } from '../lib/supabase'
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
  { id: 'home',        label: 'Home'        },
  { id: 'signals',     label: 'Signals'     },
  { id: 'profits',     label: 'Profits'     },
  { id: 'leaderboard', label: 'Leaderboard' },
  { id: 'alerts',      label: 'Alerts'      },
  { id: 'lookup',      label: 'Lookup'      },
]

const demos: Record<string, () => ReactElement> = {
  profits:     ProfitsPage,
  alerts:      AlertsPage,
  settings:    SettingsPage,
}

/* ── App Shell ── */
export default function AppShell() {
  const navigate = useNavigate()
  const [active, setActive] = useState('home')
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)
  const [category, setCategory] = useState('all')
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)

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

  const signOut = async () => {
    await supabase.auth.signOut()
    navigate('/login')
  }

  let page: ReactElement
  if (selectedWallet) {
    page = <TraderDetailPage key={selectedWallet} wallet={selectedWallet} onBack={() => setSelectedWallet(null)} />
  } else if (active === 'home') {
    page = <HomePage onOpenSignals={() => setActive('signals')} category={category} onCategoryChange={setCategory} />
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
          <nav className="app-header-nav">
            {navItems.map(({ id, label }) => (
              <button
                key={id}
                className={`app-nav-item ${active === id && !selectedWallet ? 'active' : ''}`}
                onClick={() => { setActive(id); setSelectedWallet(null) }}
              >
                {label}
              </button>
            ))}
          </nav>

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
                  <button
                    className="app-user-dropdown-item"
                    onClick={() => { setActive('settings'); setSelectedWallet(null); setUserMenuOpen(false) }}
                  >
                    Settings
                  </button>
                  <button className="app-user-dropdown-item danger" onClick={signOut}>Sign out</button>
                </div>
              )}
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
