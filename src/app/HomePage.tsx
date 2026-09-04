import { Link } from 'react-router-dom'
import { Zap, LayoutGrid, Trophy, LineChart, Bell } from 'lucide-react'
import type { User } from '@supabase/supabase-js'
import { dashboardPath, terminalPath } from '../lib/domains'

const tiles = [
  {
    to: dashboardPath('/signals'),
    Icon: Zap,
    iconBg: 'linear-gradient(135deg, #2f6fed, #5b8def)',
    badge: 'Live, Real Trades',
    title: 'Live Signals',
    desc: 'Every buy from a tracked top trader, the moment it happens.',
    large: true,
  },
  {
    to: terminalPath('/'),
    Icon: LayoutGrid,
    iconBg: 'linear-gradient(135deg, #e8563a, #f2874f)',
    badge: 'Full Market Browser',
    title: 'Terminal',
    desc: 'Charts, activity, and every contributing trader for any market.',
    large: true,
  },
  {
    to: dashboardPath('/leaderboard'),
    Icon: Trophy,
    iconBg: 'linear-gradient(135deg, #f2b73f, #f2934a)',
    badge: 'Ranked by PnL',
    title: 'Leaderboard',
    desc: 'See who is actually winning, not just who trades the most.',
  },
  {
    to: dashboardPath('/profits'),
    Icon: LineChart,
    iconBg: 'linear-gradient(135deg, #00d17a, #17b978)',
    badge: 'Payout-Adjusted',
    title: 'Profits',
    desc: 'Real, closed P&L from every tracked wallet, not paper gains.',
  },
  {
    to: dashboardPath('/alerts'),
    Icon: Bell,
    iconBg: 'linear-gradient(135deg, #8a5cf6, #a97cf7)',
    badge: 'Your Watchlist',
    title: 'Alerts',
    desc: 'Get notified the moment a wallet you follow makes a move.',
  },
]

function Tile({ t }: { t: typeof tiles[number] }) {
  return (
    <Link to={t.to} className={`home-tile ${t.large ? 'home-tile-large' : ''}`}>
      {t.badge && <span className="home-tile-badge">{t.badge}</span>}
      <div className="home-tile-head">
        <div className="home-tile-icon" style={{ background: t.iconBg }}>
          <t.Icon size={t.large ? 34 : 24} color="#fff" />
        </div>
        <div className="home-tile-title">{t.title}</div>
      </div>
      <div className="home-tile-desc">{t.desc}</div>
    </Link>
  )
}

function HomePage({ user }: { user: User | null }) {
  const displayName = user?.user_metadata?.full_name || user?.user_metadata?.name || user?.email?.split('@')[0] || 'there'
  const [large, small] = [tiles.filter(t => t.large), tiles.filter(t => !t.large)]

  return (
    <div className="sig-page">
      <div className="home-welcome">Welcome back, {displayName} 👋</div>

      <div className="home-tile-grid">
        <div className="home-tile-row home-tile-row-large">
          {large.map(t => <Tile key={t.title} t={t} />)}
        </div>
        <div className="home-tile-row home-tile-row-small">
          {small.map(t => <Tile key={t.title} t={t} />)}
        </div>
      </div>
    </div>
  )
}

export default HomePage
