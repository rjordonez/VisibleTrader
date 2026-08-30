import { useState, useEffect } from 'react'
import { NavLink, Link } from 'react-router-dom'
import { Zap, Trophy, Bell, ChevronsLeft, ChevronsRight } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { Opportunity } from '../types'
import {
  categoryIcon, categoryLabel, fmtAbbrev, fmtSigned, fmtAbbrevSigned, NAV_CATEGORIES,
  traderLabel, avatarGradient, avatarInitial, onTabVisible, WATCHED_WALLETS_KEY,
} from '../helpers'
import { terminalPath, dashboardPath } from '../../lib/domains'

type SidebarTab = 'markets' | 'leaderboard' | 'alerts'

interface LeaderboardRow {
  wallet: string
  wallet_name: string | null
  net_profit: number
}

function LeaderboardTab() {
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      Promise.resolve(
        supabase.from('leaderboard').select('wallet,wallet_name,net_profit')
          .order('net_profit', { ascending: false })
          .limit(30)
      ).then(({ data }) => {
        if (cancelled) return
        setRows((data ?? []) as LeaderboardRow[])
        setLoading(false)
      }).catch(() => { if (!cancelled) setLoading(false) })
    }
    load()
    const interval = setInterval(load, 15000)
    const unsubVisible = onTabVisible(load)
    return () => { cancelled = true; clearInterval(interval); unsubVisible() }
  }, [])

  return (
    <div className="terminal-sidebar-list">
      {loading && Array.from({ length: 8 }).map((_, i) => <div key={i} className="terminal-sidebar-skel" />)}
      {!loading && rows.length === 0 && <div className="terminal-sidebar-empty">No leaderboard data yet.</div>}
      {!loading && rows.map((r, i) => (
        <Link
          key={r.wallet}
          to={terminalPath(`/trader/${r.wallet}`)}
          className="terminal-sidebar-row"
        >
          <div className="terminal-sidebar-rank">{i + 1}</div>
          <div className="terminal-sidebar-icon" style={{ background: avatarGradient(r.wallet) }}>
            {avatarInitial(r.wallet, r.wallet_name)}
          </div>
          <div className="terminal-sidebar-mid">
            <div className="terminal-sidebar-title">{traderLabel(r.wallet, r.wallet_name)}</div>
          </div>
          <div className={`terminal-sidebar-price ${r.net_profit >= 0 ? 'g' : 'r'}`}>
            {r.net_profit >= 0 ? '▲' : '▼'} {fmtSigned(r.net_profit)}
          </div>
        </Link>
      ))}
    </div>
  )
}

function AlertsTab() {
  const [watched, setWatched] = useState<{ wallet: string }[]>([])

  useEffect(() => {
    try {
      const raw = localStorage.getItem(WATCHED_WALLETS_KEY)
      setWatched(raw ? JSON.parse(raw) : [])
    } catch { setWatched([]) }
  }, [])

  return (
    <div className="terminal-sidebar-list">
      {watched.length === 0 && (
        <div className="terminal-sidebar-empty">
          No watched wallets yet — track a trader from their profile to get alerted when they trade.
        </div>
      )}
      {watched.map(w => (
        <div key={w.wallet} className="terminal-sidebar-row">
          <div className="terminal-sidebar-icon" style={{ background: avatarGradient(w.wallet) }}>
            {avatarInitial(w.wallet, null)}
          </div>
          <div className="terminal-sidebar-mid">
            <div className="terminal-sidebar-title">{traderLabel(w.wallet, null)}</div>
            <div className="terminal-sidebar-sub">Watching</div>
          </div>
        </div>
      ))}
      <Link to={dashboardPath('/alerts')} className="terminal-sidebar-manage-link">Manage alerts →</Link>
    </div>
  )
}

// fomo's left sidebar isn't just a token list — it's a set of tabs (Alerts /
// Tokens / Leaderboard) that switch what the sidebar shows entirely. This
// mirrors that: Markets (the trending-list browser this started as),
// Leaderboard (condensed top-wallets-by-profit), and Alerts (your watched
// wallets, reusing the same localStorage list the main Alerts page reads/
// writes — read-only here, actual notification-firing/config stays on that
// one page so there's only ever one polling loop live at a time).
export default function TerminalSidebar({ opportunities, loading, category, onCategoryChange, collapsed, onToggleCollapsed }: {
  opportunities: Opportunity[]
  loading: boolean
  category: string
  onCategoryChange: (category: string) => void
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const [tab, setTab] = useState<SidebarTab>('markets')

  if (collapsed) {
    return (
      <aside className="terminal-sidebar terminal-sidebar-collapsed terminal-card">
        <button type="button" className="terminal-sidebar-collapse-btn" onClick={onToggleCollapsed} title="Expand sidebar">
          <ChevronsRight size={16} />
        </button>
      </aside>
    )
  }

  return (
    <aside className="terminal-sidebar terminal-card">
      <div className="terminal-sidebar-tabs">
        <button type="button" className={tab === 'markets' ? 'active' : ''} onClick={() => setTab('markets')}>
          <Zap size={13} /> Markets
        </button>
        <button type="button" className={tab === 'leaderboard' ? 'active' : ''} onClick={() => setTab('leaderboard')}>
          <Trophy size={13} /> Leaderboard
        </button>
        <button type="button" className={tab === 'alerts' ? 'active' : ''} onClick={() => setTab('alerts')}>
          <Bell size={13} /> Alerts
        </button>
        <button type="button" className="terminal-sidebar-collapse-btn" onClick={onToggleCollapsed} title="Collapse sidebar">
          <ChevronsLeft size={16} />
        </button>
      </div>

      {/* Hidden (not unmounted) rather than conditionally rendered — each
          tab fetches its own data on mount and polls afterward; unmounting
          on every tab switch threw that away and forced a full
          skeleton-then-refetch every single time you came back to a tab,
          on top of whatever the actual network round-trip costs. */}
      <div style={{ display: tab === 'markets' ? undefined : 'none' }}>
          <div className="terminal-sidebar-cats">
            <select value={category} onChange={e => onCategoryChange(e.target.value)}>
              <option value="all">All categories</option>
              {NAV_CATEGORIES.map(c => (
                <option key={c} value={c}>{categoryLabel(c)}</option>
              ))}
            </select>
          </div>
          <div className="terminal-sidebar-list">
            {loading && Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="terminal-sidebar-skel" />
            ))}
            {!loading && opportunities.length === 0 && (
              <div className="terminal-sidebar-empty">No active markets right now.</div>
            )}
            {!loading && opportunities.map(o => {
              const ic = categoryIcon(o.category)
              return (
                <NavLink
                  key={`${o.condition_id}::${o.outcome}`}
                  // Absolute path (via terminalPath), not relative — this
                  // list is rendered outside the inner <Routes> that owns
                  // the market/:conditionId/:outcome route, and once you're
                  // already on a market page a relative "market/..." link
                  // resolves against that current URL instead of the
                  // terminal root, producing a broken nested path that
                  // matches no route (blank content, sidebar unaffected
                  // since it's outside the failed match).
                  to={terminalPath(`/market/${encodeURIComponent(o.condition_id)}/${encodeURIComponent(o.outcome)}`)}
                  className={({ isActive }) => `terminal-sidebar-row ${isActive ? 'active' : ''}`}
                >
                  <div className="terminal-sidebar-icon" style={{ background: ic.bg }}>{ic.emoji}</div>
                  <div className="terminal-sidebar-mid">
                    <div className="terminal-sidebar-title">{o.title} <span className="sig-out">— {o.outcome}</span></div>
                    <div className="terminal-sidebar-sub">{o.wallet_count} tracked · {fmtAbbrev(o.cumulative_usd)}</div>
                  </div>
                  <div className="terminal-sidebar-trailing">
                    <div className="terminal-sidebar-price">{Math.round(o.latest_price * 100)}¢</div>
                    <div className={`terminal-sidebar-change ${o.total_profit >= 0 ? 'g' : 'r'}`}>
                      {o.total_profit >= 0 ? '▲' : '▼'} {fmtAbbrevSigned(o.total_profit)}
                    </div>
                  </div>
                </NavLink>
              )
            })}
          </div>
      </div>

      <div style={{ display: tab === 'leaderboard' ? undefined : 'none' }}>
        <LeaderboardTab />
      </div>
      <div style={{ display: tab === 'alerts' ? undefined : 'none' }}>
        <AlertsTab />
      </div>
    </aside>
  )
}
