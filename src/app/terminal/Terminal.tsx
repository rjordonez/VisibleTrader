import { useState, useEffect } from 'react'
import { Routes, Route, Link } from 'react-router-dom'
import { BarChart3, Activity, Pause, Play, X } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import { dashboardPath, terminalPath } from '../../lib/domains'
import { useSubscriptionGate } from '../../lib/subscriptionGate'
import type { Opportunity } from '../types'
import { onTabVisible, byCategory, PAGE_SIZE, fmtAbbrev, fmtAbbrevSigned } from '../helpers'
import { onOpportunitiesBatch, mergeOpportunities } from '../realtimeBroadcast'
import GlobalSearch from '../GlobalSearch'
import TerminalSidebar from './TerminalSidebar'
import TerminalMarketView from './TerminalMarketView'
import TerminalTraderView from './TerminalTraderView'
import '../app.css'
import './terminal.css'

function TerminalEmptyState({ opportunities }: { opportunities: Opportunity[] }) {
  return (
    <div className="terminal-empty terminal-card">
      <div className="terminal-empty-copy">
        <div className="terminal-empty-eyebrow">Market workspace</div>
        <div className="terminal-empty-title">What are traders watching?</div>
        <div className="terminal-empty-sub">Choose a market to see its price history, tracked activity, and conviction.</div>
      </div>
      {opportunities.length > 0 && (
        <div className="terminal-featured-markets" aria-label="Featured markets">
          {opportunities.slice(0, 3).map(o => (
            <Link
              key={`${o.condition_id}::${o.outcome}`}
              className="terminal-featured-market"
              to={terminalPath(`/market/${encodeURIComponent(o.condition_id)}/${encodeURIComponent(o.outcome)}`)}
            >
              <span className="terminal-featured-market-title">{o.title}</span>
              <span className="terminal-featured-market-meta">{o.outcome} · {o.wallet_count} tracked</span>
              <span className="terminal-featured-market-stats">
                <strong>{Math.round(o.latest_price * 100)}%</strong>
                <span className={o.total_profit >= 0 ? 'g' : 'r'}>{fmtAbbrevSigned(o.total_profit)} · {fmtAbbrev(o.cumulative_usd)} tracked</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

// A standalone full-bleed page — deliberately mounted outside AppShell (see
// App.tsx) so it gets its own top bar instead of the normal app-header/tab
// nav, matching the fomo-style "browse markets -> market detail" layout
// this was modeled on. .sig-page supplies the dark terminal color tokens
// (--bg/--surface-2/--border/--green/--red/--blue etc) already used by the
// rest of the Signals surface, so this doesn't redefine them.
export default function Terminal() {
  const { locked } = useSubscriptionGate()
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [tickerPaused, setTickerPaused] = useState(false)
  const [category, setCategory] = useState('all')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true)
  // The Terminal is a desktop-only surface — its side-by-side sidebar +
  // market panels and wide charts don't collapse to a phone. On a narrow
  // viewport we show a stub instead (the nav link stays visible so people
  // know it's there), and skip the live opportunities subscription below.
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches,
  )

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 768px)')
    const onChange = () => setIsMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    if (isMobile) return
    let cancelled = false
    const load = () => {
      Promise.resolve(
        supabase.from('opportunities_live').select('*')
          .order('cumulative_usd', { ascending: false })
          .limit(PAGE_SIZE)
      ).then(({ data, error }) => {
        if (cancelled) return
        if (error) throw error
        setOpportunities((data ?? []) as Opportunity[])
        setLoading(false)
      }).catch(() => {
        if (!cancelled) setLoading(false)
      })
    }
    load()
    // See HomePage's identical pattern/comment — live-signal-service.py
    // batches opportunities changes into one broadcast every ~5s, merged
    // into already-loaded rows here instead of refetching.
    const unsubBroadcast = onOpportunitiesBatch(rows => {
      if (cancelled) return
      setOpportunities(prev => mergeOpportunities(prev, rows))
    })
    const interval = setInterval(load, 60000)
    const unsubVisible = onTabVisible(load)
    return () => {
      cancelled = true
      clearInterval(interval)
      unsubBroadcast()
      unsubVisible()
    }
  }, [isMobile])

  const byCat = byCategory(opportunities, category)
  // Not a hard filter — a resolved/settled market's price sits pinned at
  // the very ends (0%/100%), so those are pushed toward the bottom of the
  // list instead of dropped, keeping the still-live, actually-uncertain
  // ones up top without hiding anything. Stable sort, so it only reorders
  // across this one/decided split — the existing cumulative_usd order
  // (from the query) is preserved within each half.
  const isDecidedPrice = (o: Opportunity) => o.latest_price >= 0.90 || o.latest_price <= 0.10
  const filtered = [...byCat].sort((a, b) => Number(isDecidedPrice(a)) - Number(isDecidedPrice(b)))

  if (isMobile) {
    return (
      <div className="sig-page terminal-shell">
        <header className="terminal-topbar terminal-topbar-bare">
          <Link to={dashboardPath('/')} className="terminal-logo">VisibleTrader.com</Link>
        </header>
        <div className="terminal-desktop-only">
          <div className="terminal-desktop-only-card">
            <BarChart3 className="terminal-desktop-only-icon" aria-hidden="true" />
            <h1>The Terminal is built for desktop</h1>
            <p>The market workspace needs a wider screen for its sidebar, side-by-side panels, and price charts. Open VisibleTrader.com on a computer to use it.</p>
            <Link to={dashboardPath('/')} className="terminal-desktop-only-btn">Back to dashboard</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="sig-page terminal-shell">
      <header className="terminal-topbar">
        <Link to={dashboardPath('/')} className="terminal-logo">VisibleTrader.com</Link>
        <div className="terminal-search">
          <GlobalSearch
            label="Search markets or traders"
            marketPath={m => terminalPath(`/market/${encodeURIComponent(m.condition_id)}/${encodeURIComponent(m.outcome)}`)}
            traderPath={w => terminalPath(`/trader/${w}`)}
          />
        </div>
        <Link to={dashboardPath('/')} className="terminal-exit" aria-label="Exit terminal">
          <X size={22} aria-hidden="true" />
        </Link>
      </header>

      {/* Rendered as soon as we're loading (not just once data lands) so the
          40px bar reserves its space up front and the market list below
          doesn't jump down when the real ticker fills in. */}
      {!locked && (loading || filtered.length > 0) && (
        <div className="terminal-ticker" aria-label="Tracked markets">
          <span className="terminal-ticker-label"><Activity size={16} /> Tracked markets</span>
          {filtered.length > 0 ? (
            <>
              <div className={`terminal-ticker-items ${tickerPaused ? 'is-paused' : ''}`}>
                <div className="terminal-ticker-track">
                  {[0, 1].map(copy => (
                    <div className="terminal-ticker-group" key={copy} aria-hidden={copy === 1 ? true : undefined}>
                      {filtered.slice(0, 8).map(o => (
                        <Link key={`${o.condition_id}::${o.outcome}`} tabIndex={copy === 1 ? -1 : undefined} to={terminalPath(`/market/${encodeURIComponent(o.condition_id)}/${encodeURIComponent(o.outcome)}`)} title={`${o.title} — ${o.outcome}`}>
                          <span>{o.title}</span><strong>{Math.round(o.latest_price * 100)}%</strong>
                        </Link>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <button type="button" className="terminal-ticker-toggle" onClick={() => setTickerPaused(v => !v)} aria-label={tickerPaused ? 'Play market ticker' : 'Pause market ticker'} aria-pressed={tickerPaused}>
                {tickerPaused ? <Play size={14} /> : <Pause size={14} />}
              </button>
            </>
          ) : (
            <div className="terminal-ticker-items terminal-ticker-skel" aria-hidden="true">
              {Array.from({ length: 8 }).map((_, i) => (
                <span key={i} className="terminal-ticker-skel-cell" />
              ))}
            </div>
          )}
        </div>
      )}

      <div className={`terminal-body ${locked ? 'terminal-body-locked' : ''}`}>
        <div className={locked ? 'search-locked-bg terminal-locked-inner' : 'terminal-locked-inner'}>
          <TerminalSidebar
            opportunities={filtered}
            loading={loading}
            category={category}
            onCategoryChange={setCategory}
            collapsed={sidebarCollapsed}
            onToggleCollapsed={() => setSidebarCollapsed(v => !v)}
          />
          <div className="terminal-main">
            <Routes>
              <Route index element={<TerminalEmptyState opportunities={filtered} />} />
              <Route path="market/:conditionId/:outcome" element={<TerminalMarketView opportunities={opportunities} />} />
              <Route path="trader/:wallet" element={<TerminalTraderView />} />
            </Routes>
          </div>
        </div>
        {locked && (
          <div className="search-glass-overlay">
            <p className="search-glass-title">Subscribe to unlock live signals, profits, and trader data</p>
            <Link to={dashboardPath('/pricing')} className="search-glass-btn">See plans</Link>
          </div>
        )}
      </div>
    </div>
  )
}
