import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, BarChart2, Bell, Radar, Settings } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'
import './app.css'

const navItems = [
  { id: 'signals',     label: 'Signals',     Icon: Radar      },
  { id: 'profits',     label: 'Profits',     Icon: TrendingUp },
  { id: 'leaderboard', label: 'Leaderboard', Icon: BarChart2  },
  { id: 'alerts',      label: 'Alerts',      Icon: Bell       },
  { id: 'settings',    label: 'Settings',    Icon: Settings   },
]

/* ── Types ── */
interface ScanMarket {
  id: string
  title: string
  platform: 'Kalshi' | 'Polymarket'
  yes: number
  no: number
  volume: number
}

/* ── Fetchers ── */
async function fetchKalshi(): Promise<ScanMarket[]> {
  const res = await fetch('http://localhost:5199/events?limit=100&status=open&with_nested_markets=true')
  if (!res.ok) throw new Error('Kalshi fetch failed')
  const data = await res.json()
  const out: ScanMarket[] = []
  for (const event of (data.events ?? [])) {
    // Pick only the single most liquid market per event
    const markets = (event.markets ?? []) as Record<string, string>[]
    const best = markets
      .map(m => ({ m, vol: parseFloat(m.volume_fp ?? '0') }))
      .sort((a, b) => b.vol - a.vol)[0]
    if (!best) continue
    const { m } = best
    const yes = Math.round(parseFloat(m.yes_ask_dollars ?? '0') * 100)
    const no  = Math.round(parseFloat(m.no_ask_dollars  ?? '0') * 100)
    if (yes >= 2 && yes <= 98 && best.vol > 0) {
      out.push({ id: m.ticker, title: event.title ?? m.title, platform: 'Kalshi', yes, no, volume: best.vol })
    }
  }
  return out
}

async function fetchPolymarket(): Promise<ScanMarket[]> {
  // Fetch two pages to get ~200 markets
  const [r1, r2] = await Promise.all([
    fetch('/api/polymarket/markets/keyset?limit=100&active=true&closed=false'),
    fetch('/api/polymarket/markets/keyset?limit=100&active=true&closed=false&offset=100'),
  ])
  if (!r1.ok) throw new Error('Polymarket fetch failed')
  const [d1, d2] = await Promise.all([r1.json(), r2.ok ? r2.json() : { markets: [] }])
  const all = [...(d1.markets ?? []), ...(d2.markets ?? [])]
  const out: ScanMarket[] = []
  for (const m of all) {
    try {
      const prices = JSON.parse(m.outcomePrices)
      const yes = Math.round(parseFloat(prices[0]) * 100)
      const no  = Math.round(parseFloat(prices[1]) * 100)
      const vol = m.volumeNum ?? 0
      if (yes >= 2 && yes <= 98 && vol > 0) {
        out.push({ id: m.id, title: m.question, platform: 'Polymarket', yes, no, volume: vol })
      }
    } catch {}
  }
  return out
}

/* ── Demos ── */

function ScannerDemo() {
  const [markets, setMarkets]   = useState<ScanMarket[]>([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState<string | null>(null)
  const [filter, setFilter]     = useState<'All' | 'Kalshi' | 'Polymarket'>('All')

  useEffect(() => {
    Promise.all([fetchKalshi(), fetchPolymarket()])
      .then(([k, p]) => {
        setMarkets([...k, ...p].sort((a, b) => b.volume - a.volume))
        setLoading(false)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const filtered = filter === 'All' ? markets : markets.filter(m => m.platform === filter)

  return (
    <>
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Market Scanner</h1>
          <p className="app-section-sub">
            {loading ? 'Loading live markets…' : error ? 'Could not load markets' : `${markets.length} live markets · sorted by volume`}
          </p>
        </div>
        <div className="app-filter-row">
          {(['All', 'Kalshi', 'Polymarket'] as const).map(f => (
            <button key={f} className={`app-filter ${filter === f ? 'active' : ''}`} onClick={() => setFilter(f)}>{f}</button>
          ))}
        </div>
      </div>

      {loading && (
        <div style={{ color: 'var(--text-3)', padding: '3rem', textAlign: 'center', fontSize: '0.875rem' }}>
          Fetching live markets from Kalshi &amp; Polymarket…
        </div>
      )}

      {error && (
        <div style={{ color: '#ef4444', padding: '1rem', fontSize: '0.875rem' }}>
          {error} — make sure the dev server is running (proxy required).
        </div>
      )}

      {!loading && !error && (
        <div className="app-table-wrap">
          <table className="app-table">
            <thead>
              <tr>
                <th>Market</th>
                <th>Platform</th>
                <th>YES</th>
                <th>NO</th>
                <th>Volume</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(m => (
                <tr key={m.id}>
                  <td><div className="app-market-name">{m.title}</div></td>
                  <td><span className={`app-type-badge ${m.platform === 'Kalshi' ? 'arb' : 'ev'}`}>{m.platform}</span></td>
                  <td><span className="app-price">{m.yes}¢</span></td>
                  <td><span className="app-price">{m.no}¢</span></td>
                  <td><span style={{ color: 'var(--text-3)', fontSize: '0.8rem' }}>${m.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span></td>
                  <td><button className="app-trade-btn">Trade →</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function ArbitrageDemo() {
  const opps = [
    { market: 'US recession in 2025?',           polyNo: '73¢', kalshiYes: '34¢', profit: '+4.2%' },
    { market: 'Nvidia above $200 by Dec?',        polyNo: '48¢', kalshiYes: '58¢', profit: '+2.8%' },
    { market: 'UK general election before Sep?',  polyNo: '83¢', kalshiYes: '22¢', profit: '+3.7%' },
  ]
  return (
    <>
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Arbitrage Finder</h1>
          <p className="app-section-sub">12 guaranteed-profit opportunities right now</p>
        </div>
      </div>
      <div className="app-arb-platforms">
        <div className="app-platform-card">
          <div className="app-platform-name">Kalshi</div>
          <div className="app-platform-prices">
            <div className="app-platform-price-item">
              <div className="app-platform-price-label">YES</div>
              <div className="app-platform-price-val yes">34¢</div>
            </div>
            <div className="app-platform-price-item">
              <div className="app-platform-price-label">NO</div>
              <div className="app-platform-price-val no">68¢</div>
            </div>
          </div>
        </div>
        <div className="app-platform-card">
          <div className="app-platform-name">Polymarket</div>
          <div className="app-platform-prices">
            <div className="app-platform-price-item">
              <div className="app-platform-price-label">YES</div>
              <div className="app-platform-price-val yes">29¢</div>
            </div>
            <div className="app-platform-price-item">
              <div className="app-platform-price-label">NO</div>
              <div className="app-platform-price-val no">73¢</div>
            </div>
          </div>
        </div>
      </div>
      <div className="app-arb-result">
        <div className="app-arb-result-profit">+4.2% guaranteed</div>
        <div className="app-arb-result-detail">Bet $48.20 on Kalshi YES · $51.80 on Polymarket NO · Profit: $4.20 per $100</div>
      </div>
      <div className="app-table-wrap">
        <table className="app-table">
          <thead>
            <tr><th>Market</th><th>Kalshi YES</th><th>Poly NO</th><th>Profit</th><th></th></tr>
          </thead>
          <tbody>
            {opps.map((o, i) => (
              <tr key={i}>
                <td><div className="app-market-name">{o.market}</div></td>
                <td><span className="app-price">{o.kalshiYes}</span></td>
                <td><span className="app-price">{o.polyNo}</span></td>
                <td><span className="app-ev">{o.profit}</span></td>
                <td><button className="app-trade-btn">Trade →</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function EVFeedDemo() {
  const feed = [
    { market: 'Fed holds rates at May meeting?',      platform: 'Kalshi',     price: '67¢', edge: '+11.2%' },
    { market: 'ETH above $4k by end of July?',        platform: 'Polymarket', price: '31¢', edge: '+8.9%'  },
    { market: 'Democrats win Senate in 2026?',         platform: 'Kalshi',     price: '44¢', edge: '+7.3%'  },
    { market: 'Meta releases new VR headset in 2025?', platform: 'Manifold',   price: '58¢', edge: '+6.1%'  },
    { market: 'US CPI below 3% by August?',            platform: 'Kalshi',     price: '52¢', edge: '+5.4%'  },
    { market: 'OpenAI raises at $300B+ valuation?',    platform: 'Polymarket', price: '39¢', edge: '+4.8%'  },
  ]
  return (
    <>
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">+EV Feed</h1>
          <p className="app-section-sub">Markets where the crowd is systematically wrong</p>
        </div>
      </div>
      <div className="app-ev-feed">
        {feed.map((f, i) => (
          <div key={i} className="app-ev-card">
            <div className="app-ev-card-left">
              <div className="app-ev-market">{f.market}</div>
              <div className="app-ev-meta">
                <span className="app-platform-badge">{f.platform}</span>
              </div>
            </div>
            <div className="app-ev-card-right">
              <span className="app-ev-price">{f.price}</span>
              <span className="app-ev-edge">{f.edge}</span>
              <span className="app-ev-badge">+EV</span>
              <button className="app-trade-btn">Trade →</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

/* ── Signals (live top-trader conviction feed) ── */
interface Opportunity {
  id: number
  condition_id: string
  outcome: string
  slug: string
  title: string
  cumulative_usd: number
  tier: number
  wallet_count: number
  first_seen: string
  last_updated: string
  latest_price: number
  entries: number
  exited: number
  scalped: number
  closed: number
  category: string | null
  total_profit: number
}

interface WalletContribution {
  wallet: string
  wallet_name: string | null
  usd: number
  price: number
  ts: string
  exit_ts: string | null
  exit_price: number | null
  exit_usd: number | null
  hold_seconds: number | null
  is_scalp: number | null
  market_closed: number | null
  resolved_win: number | null
  resolved_ts: string | null
}

interface TickerTrade {
  id: number
  condition_id: string
  outcome: string
  slug: string
  title: string
  usd: number
  price: number
  side: string
  wallet: string | null
  wallet_name: string | null
  roster_tagged: number
  category: string | null
  ts: string
}

const SIGNALS_PROXY = 'http://localhost:5201'

function timeAgo(iso: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (seconds < 60) return `${seconds}s ago`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

// Polymarket username when we have one (from the leaderboard scrape), else a
// shortened wallet address, else "someone" if we haven't resolved it yet.
function traderLabel(wallet: string | null, walletName: string | null) {
  if (walletName) return walletName
  if (wallet) return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`
  return 'someone'
}

function profileUrl(wallet: string | null) {
  return wallet ? `https://polymarket.com/profile/${wallet}` : null
}


const CATEGORY_ICON: Record<string, { emoji: string; bg: string }> = {
  politics:  { emoji: '🏛️', bg: 'rgba(47,111,237,0.15)' },
  sports:    { emoji: '⚽', bg: 'rgba(0,209,122,0.15)' },
  esports:   { emoji: '🎮', bg: 'rgba(168,109,255,0.18)' },
  crypto:    { emoji: '₿', bg: 'rgba(247,147,26,0.18)' },
  culture:   { emoji: '🎭', bg: 'rgba(242,183,63,0.15)' },
  mentions:  { emoji: '💬', bg: 'rgba(47,111,237,0.15)' },
  weather:   { emoji: '🌤️', bg: 'rgba(143,151,163,0.15)' },
  economics: { emoji: '📊', bg: 'rgba(0,209,122,0.15)' },
  tech:      { emoji: '✦', bg: 'rgba(168,109,255,0.18)' },
  finance:   { emoji: '💰', bg: 'rgba(242,183,63,0.15)' },
  other:     { emoji: '🔹', bg: 'rgba(143,151,163,0.15)' },
}

function categoryIcon(category: string | null) {
  return CATEGORY_ICON[category ?? 'other'] ?? CATEGORY_ICON.other
}

function categoryLabel(category: string) {
  return category.charAt(0).toUpperCase() + category.slice(1)
}

function fmtAbbrev(n: number) {
  return n >= 1000 ? '$' + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k' : '$' + Math.round(n)
}

function fmtFull(n: number) {
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function fmtSigned(n: number) {
  return (n >= 0 ? '+$' : '-$') + Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })
}

function signalsTag(tier: number, cumulativeUsd: number) {
  return tier === 0
    ? { cls: 'solo', label: 'SOLO PICK' }
    : { cls: 'big', label: `${fmtAbbrev(cumulativeUsd)} TIER` }
}

function gaugePct(entries: number, exited: number, closed: number) {
  return entries > 0 ? Math.round(((entries - exited - closed) / entries) * 100) : 100
}

function gaugeColor(pct: number) {
  return pct >= 80 ? '#00d17a' : pct >= 50 ? '#f2b73f' : '#ff3b5c'
}

function isToday(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

function signalsTraderStatus(w: WalletContribution) {
  if (w.market_closed) return { label: w.resolved_win ? 'Won' : 'Lost', color: w.resolved_win ? '#00d17a' : '#ff3b5c' }
  if (!w.exit_ts) return { label: 'Holding', color: '#00d17a' }
  if (w.is_scalp) return { label: 'Scalped', color: '#2f6fed' }
  return { label: 'Exited', color: '#ff3b5c' }
}

interface ChartPoint { t: number; p: number }

// Realized profit if resolved or exited (uses the actual settlement/exit price);
// unrealized (mark-to-market) if still holding, using the market's current price
// as a stand-in for "what could I get out right now."
function walletReturn(w: WalletContribution, currentPrice: number): { profit: number; realized: boolean } {
  const shares = w.price > 0 ? w.usd / w.price : 0
  if (w.market_closed) {
    return { profit: w.resolved_win ? shares * 1 - w.usd : -w.usd, realized: true }
  }
  if (w.exit_ts && w.exit_price != null) {
    return { profit: shares * w.exit_price - w.usd, realized: true }
  }
  return { profit: shares * currentPrice - w.usd, realized: false }
}

function SignalsDemo() {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [loading, setLoading]             = useState(true)
  const [error, setError]                 = useState<string | null>(null)
  const [expanded, setExpanded]           = useState<string | null>(null)
  const [wallets, setWallets]             = useState<WalletContribution[]>([])
  const [walletsLoading, setWalletsLoading] = useState(false)
  const [chartHistory, setChartHistory]   = useState<ChartPoint[]>([])
  const [chartLoading, setChartLoading]   = useState(false)
  const [ticker, setTicker]               = useState<TickerTrade[]>([])
  const [tab, setTab]                     = useState<'ticker' | 'vetted'>('ticker')
  const [category, setCategory]           = useState('all')
  const [todayOnly, setTodayOnly]         = useState(false)
  const [sortMode, setSortMode]           = useState<'recent' | 'profit'>('recent')

  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetch(`${SIGNALS_PROXY}/opportunities`)
        .then(res => {
          if (!res.ok) throw new Error('Signals backend unreachable')
          return res.json()
        })
        .then((data: Opportunity[]) => {
          if (cancelled) return
          setOpportunities(data)
          setLoading(false)
          setError(null)
        })
        .catch(e => {
          if (cancelled) return
          setError(e.message)
          setLoading(false)
        })
    }
    load()
    const interval = setInterval(load, 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetch(`${SIGNALS_PROXY}/ticker`)
        .then(res => res.ok ? res.json() : [])
        .then((data: TickerTrade[]) => { if (!cancelled) setTicker(data) })
        .catch(() => {})
    }
    load()
    const interval = setInterval(load, 3000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  const toggleExpand = (o: Opportunity) => {
    const key = `${o.condition_id}::${o.outcome}`
    if (expanded === key) {
      setExpanded(null)
      return
    }
    setExpanded(key)
    setWalletsLoading(true)
    setChartLoading(true)
    fetch(`${SIGNALS_PROXY}/opportunities/${encodeURIComponent(o.condition_id)}/${encodeURIComponent(o.outcome)}/wallets`)
      .then(res => res.json())
      .then((data: WalletContribution[]) => setWallets(data))
      .catch(() => setWallets([]))
      .finally(() => setWalletsLoading(false))
    fetch(`${SIGNALS_PROXY}/opportunities/${encodeURIComponent(o.condition_id)}/${encodeURIComponent(o.outcome)}/chart`)
      .then(res => res.json())
      .then((data: { history: ChartPoint[] }) => setChartHistory(data.history || []))
      .catch(() => setChartHistory([]))
      .finally(() => setChartLoading(false))
  }

  // Category chip list: whatever's actually present in live data right now, most common first — not a hardcoded taxonomy.
  const categoryCounts = new Map<string, number>()
  for (const t of ticker) {
    const c = t.category ?? 'other'
    categoryCounts.set(c, (categoryCounts.get(c) ?? 0) + 1)
  }
  for (const o of opportunities) {
    const c = o.category ?? 'other'
    categoryCounts.set(c, (categoryCounts.get(c) ?? 0) + 1)
  }
  const chipCategories = ['all', ...[...categoryCounts.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c)]

  const byCategory = <T extends { category: string | null }>(list: T[]) =>
    category === 'all' ? list : list.filter(x => (x.category ?? 'other') === category)

  const filteredTicker = byCategory(ticker).filter(t => !todayOnly || isToday(t.ts))
  const filteredOpportunities = byCategory(opportunities)
    .filter(o => !todayOnly || isToday(o.first_seen))
    .sort((a, b) => sortMode === 'profit'
      ? b.total_profit - a.total_profit
      : new Date(b.last_updated).getTime() - new Date(a.last_updated).getTime())

  return (
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Top Trader Signals</h1>
          <p className="app-section-sub">
            {loading ? 'Loading live signals…'
              : error ? 'Could not reach the signals backend'
              : <>{opportunities.length} live opportunities · capital-weighted conviction from top traders</>}
          </p>
        </div>
        {!error && <div className="sig-live">LIVE</div>}
      </div>

      <div className="sig-panel">
        <div className="sig-head">
          {error && (
            <div style={{ color: '#ff3b5c', padding: '0 0 20px', fontSize: '0.875rem' }}>
              {error} — make sure `node scripts/signals-proxy.mjs` and `python3 scripts/live-signal-service.py` are running.
            </div>
          )}

          <div className="sig-seg">
            <div className={tab === 'ticker' ? 'sig-seg-btn active' : 'sig-seg-btn'} onClick={() => setTab('ticker')}>Live Ticker</div>
            <div className={tab === 'vetted' ? 'sig-seg-btn active' : 'sig-seg-btn'} onClick={() => setTab('vetted')}>Vetted Picks</div>
          </div>

          <div className="sig-chips">
            <div
              className={todayOnly ? 'sig-chip active' : 'sig-chip'}
              onClick={() => setTodayOnly(t => !t)}
            >
              Today only
            </div>
            {chipCategories.map(c => (
              <div
                key={c}
                className={category === c ? 'sig-chip active' : 'sig-chip'}
                onClick={() => setCategory(c)}
              >
                {c === 'all' ? 'All' : categoryLabel(c)}
              </div>
            ))}
          </div>
        </div>

        {tab === 'ticker' && (
          <div className="sig-list">
            {filteredTicker.length === 0 && (
              <div className="sig-empty">Waiting for a big trade…</div>
            )}
            {filteredTicker.map(t => {
              const ic = categoryIcon(t.category)
              return (
                <div key={t.id} className="sig-row">
                  <div className="sig-icon" style={{ background: ic.bg }}>{ic.emoji}</div>
                  <div className="sig-mid">
                    <div className="sig-q">{t.title} <span className="sig-out">— {t.outcome}</span></div>
                    <div className="sig-meta">
                      {t.wallet ? (
                        <a href={profileUrl(t.wallet)!} target="_blank" rel="noopener noreferrer" style={{ color: 'inherit' }}>
                          {traderLabel(t.wallet, t.wallet_name)}
                        </a>
                      ) : (
                        <span>someone</span>
                      )}
                      {t.roster_tagged ? <span className="sig-trk">Tracked</span> : null}
                      <span>· {timeAgo(t.ts)}</span>
                    </div>
                  </div>
                  <div className="sig-right">
                    <span className={`sig-pill ${t.side === 'BUY' ? 'buy' : 'sell'}`}>{t.side}</span>
                    <div className="sig-rowprice">{Math.round(t.price * 100)}¢</div>
                    <div className="sig-rowsize">{fmtFull(t.usd)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {tab === 'vetted' && (
          <>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              <div className={sortMode === 'recent' ? 'sig-chip active' : 'sig-chip'} onClick={() => setSortMode('recent')}>Most recent</div>
              <div className={sortMode === 'profit' ? 'sig-chip active' : 'sig-chip'} onClick={() => setSortMode('profit')}>Most profitable</div>
            </div>
          <div className="sig-grid">
            {loading && <div className="sig-empty">Connecting to the live signal feed…</div>}
            {!loading && filteredOpportunities.length === 0 && (
              <div className="sig-empty">No opportunities detected yet — the live backend hasn't caught a tracked trader's trade yet. This is normal; keep it running.</div>
            )}
            {!loading && filteredOpportunities.map(o => {
              const key = `${o.condition_id}::${o.outcome}`
              const isOpen = expanded === key
              const ic = categoryIcon(o.category)
              const pct = gaugePct(o.entries, o.exited, o.closed)
              const color = gaugeColor(pct)
              // Gauge is a half-circle (top 180°) with the bottom half open — not a
              // full 360° ring — the track and the fill both stop short of meeting
              // at the bottom regardless of pct.
              const r = 32, c = 2 * Math.PI * r
              const arcLen = c * 0.5
              const dash = (pct / 100) * arcLen
              const tag = signalsTag(o.tier, o.cumulative_usd)
              return (
                <div key={key} className="sig-card" onClick={() => toggleExpand(o)}>
                  <div className="sig-card-top">
                    <div className="sig-card-icon" style={{ background: ic.bg }}>{ic.emoji}</div>
                    <div style={{ flex: 1 }}>
                      <div className="sig-card-q">{o.title} <span className="sig-out">— {o.outcome}</span></div>
                      <div className="sig-card-meta">{o.wallet_count} top trader{o.wallet_count > 1 ? 's' : ''}</div>
                    </div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: o.total_profit >= 0 ? '#00d17a' : '#ff3b5c', flexShrink: 0 }}>
                      {fmtSigned(o.total_profit)}
                    </div>
                  </div>
                  <div className="sig-gauge-row">
                    <div className="sig-gauge">
                      <svg width="80" height="80" viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r={r} fill="none" stroke="#33363d" strokeWidth="7"
                          strokeDasharray={`${arcLen} ${c}`} strokeLinecap="round" />
                        <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="7"
                          strokeDasharray={`${dash} ${c}`} strokeLinecap="round" />
                      </svg>
                      <div className="sig-gauge-label">
                        <div className="sig-gauge-pct">{pct}%</div>
                        <div className="sig-gauge-sub">in</div>
                      </div>
                    </div>
                    <div className="sig-stat-col">
                      <div className="sig-stat"><span className="sig-stat-label">Price</span><span className="sig-stat-val">{Math.round(o.latest_price * 100)}¢</span></div>
                      <div className="sig-stat"><span className="sig-stat-label">Total</span><span className="sig-stat-val g">{fmtFull(o.cumulative_usd)}</span></div>
                      {o.scalped > 0 && (
                        <div className="sig-stat"><span className="sig-stat-label">Scalped</span><span className="sig-stat-val r">{o.scalped}</span></div>
                      )}
                    </div>
                  </div>
                  <div className={`sig-tag ${tag.cls}`}>{tag.label}</div>

                  {isOpen && (
                    <div className="sig-drill" onClick={e => e.stopPropagation()}>
                      <div className="sig-drill-label">Price history — dots mark each trader's buy-in</div>
                      {chartLoading && <div style={{ color: 'var(--text-dim)', fontSize: 12.5, marginBottom: 12 }}>Loading chart…</div>}
                      {!chartLoading && chartHistory.length < 2 && (
                        <div style={{ color: 'var(--text-dim)', fontSize: 12.5, marginBottom: 12 }}>No price history available for this market.</div>
                      )}
                      {!chartLoading && chartHistory.length >= 2 && (
                        <div style={{ marginBottom: 16 }}>
                          <PriceChart history={chartHistory} wallets={wallets} />
                        </div>
                      )}

                      <div className="sig-drill-label">Contributing traders</div>
                      {walletsLoading && <div style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>Loading contributors…</div>}
                      {!walletsLoading && wallets.length === 0 && (
                        <div style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>No contributor detail available.</div>
                      )}
                      {!walletsLoading && wallets.map((w, i) => {
                        const st = signalsTraderStatus(w)
                        const ret = walletReturn(w, o.latest_price)
                        return (
                          <div key={i} className="sig-drill-row">
                            <a href={profileUrl(w.wallet)!} target="_blank" rel="noopener noreferrer" className="sig-drill-name">
                              {traderLabel(w.wallet, w.wallet_name)}
                            </a>
                            <div className="sig-drill-detail">
                              {fmtFull(w.usd)} at {Math.round(w.price * 100)}¢ · {timeAgo(w.ts)}
                            </div>
                            <div style={{ fontSize: 11.5, fontWeight: 700, color: ret.profit >= 0 ? '#00d17a' : '#ff3b5c', flexShrink: 0 }}>
                              {fmtSigned(ret.profit)}{!ret.realized ? ' (unrealized)' : ''}
                            </div>
                            <div className="sig-drill-status" style={{ color: st.color, background: st.color + '26' }}>
                              {st.label}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          </>
        )}

        <div className="sig-foot">
          {tab === 'ticker' ? 'Raw trade activity, $100+ · not a recommendation' : 'Positions still open, weighted by trader conviction'}
        </div>
      </div>
    </div>
  )
}

/* ── Profits ── */
interface ProfitsSummary {
  resolved_n: number
  won: number
  lost: number
  deployed: number
  net_profit: number
}

interface ProfitsDaily {
  d: string
  day_profit: number
}

interface ProfitsPosition {
  wallet: string
  wallet_name: string | null
  title: string
  outcome: string
  usd: number
  price: number
  resolved_win: number
  resolved_ts: string
  profit: number
}

function PriceChart({ history, wallets }: { history: ChartPoint[]; wallets: WalletContribution[] }) {
  if (history.length < 2) return null
  const width = 1000, height = 220, padding = 24
  const times = history.map(h => h.t)
  const minT = Math.min(...times)
  const maxT = Math.max(...times)
  const tRange = maxT - minT || 1
  const xFor = (t: number) => padding + ((t - minT) / tRange) * (width - padding * 2)
  const yFor = (p: number) => height - padding - p * (height - padding * 2) // price is always 0–1, fixed scale so moves aren't exaggerated
  const points = history.map(h => `${xFor(h.t)},${yFor(h.p)}`).join(' ')

  const markers = wallets
    .map(w => {
      const t = new Date(w.ts).getTime() / 1000
      if (t < minT || t > maxT) return null
      const st = signalsTraderStatus(w)
      return { x: xFor(t), y: yFor(w.price), color: st.color, label: `${traderLabel(w.wallet, w.wallet_name)} — ${st.label} — ${fmtFull(w.usd)} at ${Math.round(w.price * 100)}¢` }
    })
    .filter((m): m is { x: number; y: number; color: string; label: string } => m !== null)

  return (
    <svg className="sig-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ height: 220 }}>
      <line x1={padding} y1={yFor(1)} x2={width - padding} y2={yFor(1)} stroke="var(--border)" strokeWidth={1} />
      <line x1={padding} y1={yFor(0.5)} x2={width - padding} y2={yFor(0.5)} stroke="var(--border)" strokeWidth={1} strokeDasharray="3 3" />
      <line x1={padding} y1={yFor(0)} x2={width - padding} y2={yFor(0)} stroke="var(--border)" strokeWidth={1} />
      <text x={padding} y={yFor(1) - 4} fill="var(--text-faint)" fontSize="9">100¢</text>
      <text x={padding} y={yFor(0) - 4} fill="var(--text-faint)" fontSize="9">0¢</text>
      <polyline points={points} fill="none" stroke="#2f6fed" strokeWidth={2} />
      {markers.map((m, i) => (
        <circle key={i} cx={m.x} cy={m.y} r={5} fill={m.color} stroke="#0b0d10" strokeWidth={1.5}>
          <title>{m.label}</title>
        </circle>
      ))}
    </svg>
  )
}

function CumulativeChart({ data }: { data: { d: string; cum: number }[] }) {
  const width = 1000, height = 160, padding = 20
  const values = data.map(d => d.cum)
  const min = Math.min(0, ...values)
  const max = Math.max(0, ...values)
  const range = max - min || 1
  const xStep = (width - padding * 2) / Math.max(1, data.length - 1)
  const yFor = (v: number) => height - padding - ((v - min) / range) * (height - padding * 2)
  const points = data.map((d, i) => `${padding + i * xStep},${yFor(d.cum)}`).join(' ')
  const last = values[values.length - 1] ?? 0
  const lineColor = last >= 0 ? '#00d17a' : '#ff3b5c'
  return (
    <svg className="sig-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <line x1={padding} y1={yFor(0)} x2={width - padding} y2={yFor(0)} stroke="var(--border)" strokeWidth={1} />
      <polyline points={points} fill="none" stroke={lineColor} strokeWidth={2} />
    </svg>
  )
}

function ProfitsPage() {
  const [summary, setSummary] = useState<ProfitsSummary | null>(null)
  const [daily, setDaily] = useState<ProfitsDaily[]>([])
  const [positions, setPositions] = useState<ProfitsPosition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetch(`${SIGNALS_PROXY}/profits`)
        .then(res => {
          if (!res.ok) throw new Error('Signals backend unreachable')
          return res.json()
        })
        .then((data: { summary: ProfitsSummary | null; daily: ProfitsDaily[]; positions: ProfitsPosition[] }) => {
          if (cancelled) return
          setSummary(data.summary)
          setDaily(data.daily)
          setPositions(data.positions)
          setLoading(false)
          setError(null)
        })
        .catch(e => {
          if (cancelled) return
          setError(e.message)
          setLoading(false)
        })
    }
    load()
    const interval = setInterval(load, 15000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  const winRate = summary && summary.won + summary.lost > 0 ? (summary.won / (summary.won + summary.lost)) * 100 : 0
  const roi = summary && summary.deployed > 0 ? (summary.net_profit / summary.deployed) * 100 : 0

  let running = 0
  const cumulative = daily.map(d => {
    running += d.day_profit
    return { d: d.d, cum: running }
  })

  return (
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Profits</h1>
          <p className="app-section-sub">
            {loading ? 'Loading…'
              : error ? 'Could not reach the signals backend'
              : 'Real resolved P&L from tracked roster positions — payout-adjusted, not just win/loss count'}
          </p>
        </div>
      </div>

      <div className="sig-panel">
        {error && (
          <div style={{ color: '#ff3b5c', padding: '0 0 20px', fontSize: '0.875rem' }}>{error}</div>
        )}

        {!loading && !error && summary && summary.resolved_n > 0 && (
          <>
            <div className="sig-stats-row">
              <div className="sig-stat-cell">
                <div className="sig-stat-cell-label">Net P&L</div>
                <div className={`sig-stat-cell-val ${summary.net_profit >= 0 ? 'g' : 'r'}`}>{fmtSigned(summary.net_profit)}</div>
              </div>
              <div className="sig-stat-cell">
                <div className="sig-stat-cell-label">Win Rate</div>
                <div className="sig-stat-cell-val">{winRate.toFixed(1)}%</div>
              </div>
              <div className="sig-stat-cell">
                <div className="sig-stat-cell-label">ROI</div>
                <div className={`sig-stat-cell-val ${roi >= 0 ? 'g' : 'r'}`}>{roi >= 0 ? '+' : ''}{roi.toFixed(1)}%</div>
              </div>
              <div className="sig-stat-cell">
                <div className="sig-stat-cell-label">Resolved</div>
                <div className="sig-stat-cell-val">{summary.resolved_n}</div>
              </div>
            </div>

            {cumulative.length > 1 && <CumulativeChart data={cumulative} />}

            <div className="sig-table-wrap">
              <table className="sig-table">
                <thead>
                  <tr>
                    <th>Market</th>
                    <th>Trader</th>
                    <th className="num">Stake</th>
                    <th className="num">Price</th>
                    <th>Result</th>
                    <th className="num">Profit</th>
                    <th className="num">Resolved</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p, i) => (
                    <tr key={i}>
                      <td>{p.title} <span style={{ color: 'var(--text-dim)' }}>— {p.outcome}</span></td>
                      <td>
                        {p.wallet ? (
                          <a href={profileUrl(p.wallet)!} target="_blank" rel="noopener noreferrer">
                            {traderLabel(p.wallet, p.wallet_name)}
                          </a>
                        ) : '—'}
                      </td>
                      <td className="num">{fmtFull(p.usd)}</td>
                      <td className="num">{Math.round(p.price * 100)}¢</td>
                      <td style={{ color: p.resolved_win ? 'var(--green)' : 'var(--red)' }}>{p.resolved_win ? 'Won' : 'Lost'}</td>
                      <td className="num" style={{ color: p.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(p.profit)}</td>
                      <td className="num" style={{ color: 'var(--text-dim)' }}>{timeAgo(p.resolved_ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!loading && !error && (!summary || summary.resolved_n === 0) && (
          <div className="sig-empty">No resolved positions yet — check back once tracked signals start settling.</div>
        )}
      </div>
    </div>
  )
}

/* ── Leaderboard ── */
interface LeaderboardRow {
  wallet: string
  wallet_name: string | null
  n: number
  won: number
  lost: number
  deployed: number
  won_usd: number
  net_profit: number
}

function LeaderboardPage({ onSelectWallet }: { onSelectWallet: (wallet: string) => void }) {
  const [rows, setRows] = useState<LeaderboardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetch(`${SIGNALS_PROXY}/leaderboard`)
        .then(res => {
          if (!res.ok) throw new Error('Signals backend unreachable')
          return res.json()
        })
        .then((data: LeaderboardRow[]) => {
          if (cancelled) return
          setRows(data)
          setLoading(false)
          setError(null)
        })
        .catch(e => {
          if (cancelled) return
          setError(e.message)
          setLoading(false)
        })
    }
    load()
    const interval = setInterval(load, 15000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  return (
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Leaderboard</h1>
          <p className="app-section-sub">
            {loading ? 'Loading…'
              : error ? 'Could not reach the signals backend'
              : "Real observed performance per tracked wallet — not their claimed Polymarket PnL"}
          </p>
        </div>
      </div>

      <div className="sig-panel">
        {error && (
          <div style={{ color: '#ff3b5c', padding: '0 0 20px', fontSize: '0.875rem' }}>{error}</div>
        )}

        {!loading && !error && rows.length === 0 && (
          <div className="sig-empty">No resolved positions yet.</div>
        )}

        {!loading && !error && rows.length > 0 && (
          <div className="sig-table-wrap">
            <table className="sig-table">
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th>Trader</th>
                  <th className="num">Trades</th>
                  <th className="num" title="Winning trades ÷ total resolved trades">Win Rate (#)</th>
                  <th className="num" title="Dollars in winning trades ÷ total dollars deployed — weights by position size, not trade count">Win Rate ($)</th>
                  <th className="num">Deployed</th>
                  <th className="num">Profit</th>
                  <th className="num">ROI</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const winRate = r.won + r.lost > 0 ? (r.won / (r.won + r.lost)) * 100 : 0
                  const usdWinRate = r.deployed > 0 ? (r.won_usd / r.deployed) * 100 : 0
                  const roi = r.deployed > 0 ? (r.net_profit / r.deployed) * 100 : 0
                  return (
                    <tr key={r.wallet}>
                      <td className="num" style={{ color: 'var(--text-dim)' }}>{i + 1}</td>
                      <td>
                        <a href="#" onClick={e => { e.preventDefault(); onSelectWallet(r.wallet) }}>
                          {traderLabel(r.wallet, r.wallet_name)}
                        </a>
                        <a
                          href={profileUrl(r.wallet)!} target="_blank" rel="noopener noreferrer"
                          style={{ marginLeft: 6, color: 'var(--text-faint)', fontSize: 11 }}
                        >
                          ↗
                        </a>
                      </td>
                      <td className="num">{r.n}</td>
                      <td className="num">{winRate.toFixed(0)}%</td>
                      <td className="num">{usdWinRate.toFixed(0)}%</td>
                      <td className="num">{fmtFull(r.deployed)}</td>
                      <td className="num" style={{ color: r.net_profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(r.net_profit)}</td>
                      <td className="num" style={{ color: roi >= 0 ? 'var(--green)' : 'var(--red)' }}>{roi >= 0 ? '+' : ''}{roi.toFixed(1)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Trader detail ── */
interface TraderSummary {
  wallet: string
  wallet_name: string | null
  n: number
  won: number
  lost: number
  deployed: number
  won_usd: number
  net_profit: number
}

interface TraderPosition {
  title: string
  outcome: string
  category: string | null
  usd: number
  price: number
  resolved_win: number
  resolved_ts: string
  profit: number
}

interface TraderCategoryStat {
  category: string
  n: number
  won: number
  lost: number
  profit: number
}

function TraderDetailPage({ wallet, onBack }: { wallet: string; onBack: () => void }) {
  const [summary, setSummary] = useState<TraderSummary | null>(null)
  const [positions, setPositions] = useState<TraderPosition[]>([])
  const [byCategory, setByCategory] = useState<TraderCategoryStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetch(`${SIGNALS_PROXY}/trader/${encodeURIComponent(wallet)}`)
      .then(res => {
        if (!res.ok) throw new Error('Signals backend unreachable')
        return res.json()
      })
      .then((data: { summary: TraderSummary | null; positions: TraderPosition[]; by_category: TraderCategoryStat[] }) => {
        if (cancelled) return
        setSummary(data.summary)
        setPositions(data.positions)
        setByCategory(data.by_category)
        setLoading(false)
        setError(null)
      })
      .catch(e => {
        if (cancelled) return
        setError(e.message)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [wallet])

  const winRate = summary && summary.won + summary.lost > 0 ? (summary.won / (summary.won + summary.lost)) * 100 : 0
  const usdWinRate = summary && summary.deployed > 0 ? (summary.won_usd / summary.deployed) * 100 : 0
  const roi = summary && summary.deployed > 0 ? (summary.net_profit / summary.deployed) * 100 : 0

  return (
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <button className="sig-btn secondary" onClick={onBack} style={{ marginBottom: 12 }}>← Back to Leaderboard</button>
          <h1 className="app-section-title">{traderLabel(wallet, summary?.wallet_name ?? null)}</h1>
          <p className="app-section-sub">
            {loading ? 'Loading…' : error ? 'Could not reach the signals backend' : (
              <a href={profileUrl(wallet)!} target="_blank" rel="noopener noreferrer">View on Polymarket ↗</a>
            )}
          </p>
        </div>
      </div>

      <div className="sig-panel">
        {error && (
          <div style={{ color: '#ff3b5c', padding: '0 0 20px', fontSize: '0.875rem' }}>{error}</div>
        )}

        {!loading && !error && summary && (
          <>
            <div className="sig-stats-row">
              <div className="sig-stat-cell">
                <div className="sig-stat-cell-label">Net P&L</div>
                <div className={`sig-stat-cell-val ${summary.net_profit >= 0 ? 'g' : 'r'}`}>{fmtSigned(summary.net_profit)}</div>
              </div>
              <div className="sig-stat-cell">
                <div className="sig-stat-cell-label" title="Winning trades ÷ total resolved trades">Win Rate (#)</div>
                <div className="sig-stat-cell-val">{winRate.toFixed(1)}%</div>
              </div>
              <div className="sig-stat-cell">
                <div className="sig-stat-cell-label" title="Dollars in winning trades ÷ total dollars deployed">Win Rate ($)</div>
                <div className="sig-stat-cell-val">{usdWinRate.toFixed(1)}%</div>
              </div>
              <div className="sig-stat-cell">
                <div className="sig-stat-cell-label">ROI</div>
                <div className={`sig-stat-cell-val ${roi >= 0 ? 'g' : 'r'}`}>{roi >= 0 ? '+' : ''}{roi.toFixed(1)}%</div>
              </div>
              <div className="sig-stat-cell">
                <div className="sig-stat-cell-label">Resolved Trades</div>
                <div className="sig-stat-cell-val">{summary.n}</div>
              </div>
            </div>

            {byCategory.length > 0 && (
              <>
                <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>By category</div>
                <div className="sig-table-wrap" style={{ marginBottom: 24 }}>
                  <table className="sig-table">
                    <thead>
                      <tr><th>Category</th><th className="num">Trades</th><th className="num">Win Rate</th><th className="num">Profit</th></tr>
                    </thead>
                    <tbody>
                      {byCategory.map(c => {
                        const cwr = c.won + c.lost > 0 ? (c.won / (c.won + c.lost)) * 100 : 0
                        return (
                          <tr key={c.category}>
                            <td>{categoryLabel(c.category)}</td>
                            <td className="num">{c.n}</td>
                            <td className="num">{cwr.toFixed(0)}%</td>
                            <td className="num" style={{ color: c.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(c.profit)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>All resolved positions</div>
            <div className="sig-table-wrap">
              <table className="sig-table">
                <thead>
                  <tr><th>Market</th><th className="num">Stake</th><th className="num">Price</th><th>Result</th><th className="num">Profit</th><th className="num">Resolved</th></tr>
                </thead>
                <tbody>
                  {positions.map((p, i) => (
                    <tr key={i}>
                      <td>{p.title} <span style={{ color: 'var(--text-dim)' }}>— {p.outcome}</span></td>
                      <td className="num">{fmtFull(p.usd)}</td>
                      <td className="num">{Math.round(p.price * 100)}¢</td>
                      <td style={{ color: p.resolved_win ? 'var(--green)' : 'var(--red)' }}>{p.resolved_win ? 'Won' : 'Lost'}</td>
                      <td className="num" style={{ color: p.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(p.profit)}</td>
                      <td className="num" style={{ color: 'var(--text-dim)' }}>{timeAgo(p.resolved_ts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {!loading && !error && !summary && (
          <div className="sig-empty">No resolved positions for this wallet yet.</div>
        )}
      </div>
    </div>
  )
}

/* ── Alerts ── */
interface WalletWatch { wallet: string }
interface AlertEvent { id: string; text: string; ts: number }

const WATCHED_WALLETS_KEY = 'visibletrader_watched_wallets'
const WATCHED_TIER_KEY = 'visibletrader_watched_tier'

function AlertsPage() {
  const [watchedWallets, setWatchedWallets] = useState<WalletWatch[]>(() => {
    try {
      const raw = localStorage.getItem(WATCHED_WALLETS_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })
  const [minTier, setMinTier] = useState<number>(() => {
    const raw = localStorage.getItem(WATCHED_TIER_KEY)
    return raw ? Number(raw) : 5000
  })
  const [walletInput, setWalletInput] = useState('')
  const [permission, setPermission] = useState<NotificationPermission>(
    typeof window !== 'undefined' && 'Notification' in window ? Notification.permission : 'denied'
  )
  const [history, setHistory] = useState<AlertEvent[]>([])
  const seenTicker = useRef<Set<number>>(new Set())
  const seenTier = useRef<Set<string>>(new Set())

  useEffect(() => { localStorage.setItem(WATCHED_WALLETS_KEY, JSON.stringify(watchedWallets)) }, [watchedWallets])
  useEffect(() => { localStorage.setItem(WATCHED_TIER_KEY, String(minTier)) }, [minTier])

  const fire = (text: string) => {
    setHistory(h => [{ id: `${Date.now()}-${Math.random()}`, text, ts: Date.now() }, ...h].slice(0, 50))
    if (permission === 'granted' && 'Notification' in window) {
      new Notification('VisibleTrader Signals', { body: text })
    }
  }

  useEffect(() => {
    if (watchedWallets.length === 0) return
    let cancelled = false
    const load = () => {
      fetch(`${SIGNALS_PROXY}/ticker`)
        .then(res => (res.ok ? res.json() : []))
        .then((data: TickerTrade[]) => {
          if (cancelled) return
          for (const t of data) {
            if (!t.wallet || seenTicker.current.has(t.id)) continue
            const watched = watchedWallets.find(w => w.wallet.toLowerCase() === t.wallet!.toLowerCase())
            if (!watched) continue
            seenTicker.current.add(t.id)
            fire(`${traderLabel(t.wallet, t.wallet_name)} ${t.side === 'BUY' ? 'bought' : 'sold'} ${fmtFull(t.usd)} — ${t.title}`)
          }
        })
        .catch(() => {})
    }
    load()
    const interval = setInterval(load, 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [watchedWallets, permission])

  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetch(`${SIGNALS_PROXY}/opportunities`)
        .then(res => (res.ok ? res.json() : []))
        .then((data: Opportunity[]) => {
          if (cancelled) return
          for (const o of data) {
            if (o.tier < minTier) continue
            const key = `${o.condition_id}::${o.outcome}::${o.tier}`
            if (seenTier.current.has(key)) continue
            seenTier.current.add(key)
            fire(`Tier crossed: ${o.title} — ${o.outcome} hit ${fmtFull(o.tier)}+ (${o.wallet_count} wallets)`)
          }
        })
        .catch(() => {})
    }
    load()
    const interval = setInterval(load, 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [minTier, permission])

  const requestPermission = () => {
    if (!('Notification' in window)) return
    Notification.requestPermission().then(p => setPermission(p))
  }

  const addWallet = () => {
    const addr = walletInput.trim()
    if (!addr) return
    setWatchedWallets(w => (w.some(x => x.wallet.toLowerCase() === addr.toLowerCase()) ? w : [...w, { wallet: addr }]))
    setWalletInput('')
  }

  const removeWallet = (wallet: string) => setWatchedWallets(w => w.filter(x => x.wallet !== wallet))

  return (
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Alerts</h1>
          <p className="app-section-sub">Fires while this tab is open — not a background/closed-tab push notification</p>
        </div>
      </div>

      <div className="sig-panel">
        {permission !== 'granted' && (
          <div style={{ marginBottom: 24 }}>
            <button className="sig-btn" onClick={requestPermission}>Enable browser notifications</button>
          </div>
        )}

        <div style={{ marginBottom: 28 }}>
          <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Watch a wallet</div>
          <div className="sig-watch-form">
            <input
              className="sig-watch-input"
              placeholder="0x… wallet address"
              value={walletInput}
              onChange={e => setWalletInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && addWallet()}
            />
            <button className="sig-btn" onClick={addWallet}>Add</button>
          </div>
          {watchedWallets.map(w => (
            <div key={w.wallet} className="sig-watch-item">
              <span>{traderLabel(w.wallet, null)}</span>
              <span className="sig-watch-remove" onClick={() => removeWallet(w.wallet)}>Remove</span>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 28 }}>
          <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Alert on any signal crossing</div>
          <div className="sig-chips">
            {[1000, 5000, 20000, 50000, 100000].map(t => (
              <div key={t} className={minTier === t ? 'sig-chip active' : 'sig-chip'} onClick={() => setMinTier(t)}>
                {fmtFull(t)}+
              </div>
            ))}
          </div>
        </div>

        <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Alert history</div>
        {history.length === 0 ? (
          <div className="sig-empty">No alerts yet.</div>
        ) : (
          <div className="sig-table-wrap">
            <table className="sig-table">
              <tbody>
                {history.map(h => (
                  <tr key={h.id}>
                    <td>{h.text}</td>
                    <td className="num" style={{ color: 'var(--text-dim)', width: 90 }}>{timeAgo(new Date(h.ts).toISOString())}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function PortfolioDemo() {
  const positions = [
    { market: 'Fed cuts rates in July?',      platform: 'Kalshi',     entry: '38¢', current: '45¢', pnl: '+$18.40', win: true  },
    { market: 'Bitcoin above $120k by Aug?',  platform: 'Polymarket', entry: '25¢', current: '33¢', pnl: '+$32.00', win: true  },
    { market: 'US recession in 2025?',         platform: 'Kalshi',     entry: '42¢', current: '34¢', pnl: '-$16.00', win: false },
    { market: 'SpaceX orbital flight Q3?',     platform: 'Manifold',   entry: '60¢', current: '71¢', pnl: '+$22.00', win: true  },
    { market: 'Apple M4 MacBook by October?', platform: 'Kalshi',     entry: '55¢', current: '52¢', pnl: '-$6.00',  win: false },
  ]
  return (
    <>
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Portfolio</h1>
          <p className="app-section-sub">Your positions and performance across all platforms</p>
        </div>
      </div>
      <div className="app-stats-row">
        <div className="app-stat-card">
          <div className="app-stat-label">Total P&amp;L</div>
          <div className="app-stat-value green">+$1,240</div>
        </div>
        <div className="app-stat-card">
          <div className="app-stat-label">Win Rate</div>
          <div className="app-stat-value accent">61%</div>
        </div>
        <div className="app-stat-card">
          <div className="app-stat-label">Open Positions</div>
          <div className="app-stat-value">12</div>
        </div>
        <div className="app-stat-card">
          <div className="app-stat-label">ROI</div>
          <div className="app-stat-value green">+18.4%</div>
        </div>
      </div>
      <div className="app-table-wrap">
        <table className="app-table">
          <thead>
            <tr><th>Market</th><th>Platform</th><th>Entry</th><th>Current</th><th>P&amp;L</th></tr>
          </thead>
          <tbody>
            {positions.map((p, i) => (
              <tr key={i}>
                <td><div className="app-market-name">{p.market}</div></td>
                <td><span className="app-tag">{p.platform}</span></td>
                <td><span className="app-price">{p.entry}</span></td>
                <td><span className="app-price">{p.current}</span></td>
                <td><span style={{ fontWeight: 700, color: p.win ? '#10b981' : '#ef4444' }}>{p.pnl}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

function AlertsDemo() {
  const [alerts, setAlerts] = useState([
    { name: 'ARB ≥ 5%',          cond: 'Any platform — min 5% guaranteed profit', on: true  },
    { name: '+EV ≥ 10%',         cond: 'Any market — min 10% expected value',      on: true  },
    { name: 'Kalshi Politics',    cond: 'New political market opens on Kalshi',     on: false },
    { name: 'Polymarket Crypto',  cond: 'Crypto market price moves > 5¢',          on: true  },
    { name: 'Promo Available',    cond: 'New platform bonus detected',              on: false },
    { name: 'Portfolio down 10%', cond: 'Open positions drop 10% in 24h',          on: true  },
  ])
  const toggle = (i: number) => setAlerts(prev => prev.map((a, idx) => idx === i ? { ...a, on: !a.on } : a))
  return (
    <>
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Live Alerts</h1>
          <p className="app-section-sub">Get notified the moment an edge opens</p>
        </div>
        <button className="app-add-btn">+ Add Alert</button>
      </div>
      <div className="app-alerts-list">
        {alerts.map((a, i) => (
          <div key={i} className="app-alert-row">
            <div>
              <div className="app-alert-name">{a.name}</div>
              <div className="app-alert-cond">{a.cond}</div>
            </div>
            <div className={`app-toggle ${a.on ? 'on' : ''}`} onClick={() => toggle(i)} style={{ cursor: 'pointer' }}>
              <div className="app-toggle-track" />
              <div className="app-toggle-thumb" />
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

function PromosDemo() {
  const promos = [
    { platform: 'Kalshi',     name: 'Welcome Deposit Match', value: '$200', expiry: 'Expires Jul 31' },
    { platform: 'Polymarket', name: 'First Trade Bonus',      value: '$50',  expiry: 'Expires Aug 15' },
    { platform: 'Manifold',   name: 'Refer a Friend',         value: '$25',  expiry: 'Ongoing'        },
    { platform: 'Limitless',  name: 'New User Bonus',         value: '$100', expiry: 'Expires Jul 20' },
  ]
  return (
    <>
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Promos</h1>
          <p className="app-section-sub">Available platform bonuses and how to extract them</p>
        </div>
      </div>
      <div className="app-promos-grid">
        {promos.map((p, i) => (
          <div key={i} className="app-promo-card">
            <div className="app-promo-platform">{p.platform}</div>
            <div className="app-promo-name">{p.name}</div>
            <div className="app-promo-value">{p.value}</div>
            <div className="app-promo-expiry">{p.expiry}</div>
            <button className="app-claim-btn">Claim Bonus →</button>
          </div>
        ))}
      </div>
    </>
  )
}

/* ── Settings ── */
interface AppSettings {
  roster_size: number
  tiers: number[]
  ticker_min_usd: number
  scalp_window_minutes: number
}

const SETTINGS_DEFAULT: AppSettings = {
  roster_size: 500,
  tiers: [1000, 5000, 20000, 50000, 100000],
  ticker_min_usd: 100,
  scalp_window_minutes: 30,
}

function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings>(SETTINGS_DEFAULT)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle')

  useEffect(() => {
    fetch(`${SIGNALS_PROXY}/settings`)
      .then(res => {
        if (!res.ok) throw new Error('Signals backend unreachable')
        return res.json()
      })
      .then((data: AppSettings) => {
        setSettings(data)
        setLoading(false)
      })
      .catch(e => {
        setError(e.message)
        setLoading(false)
      })
  }, [])

  const setTier = (i: number, value: number) => {
    setSettings(s => ({ ...s, tiers: s.tiers.map((t, idx) => (idx === i ? value : t)) }))
  }

  const save = () => {
    setSaveState('saving')
    fetch(`${SIGNALS_PROXY}/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
      .then(res => {
        if (!res.ok) throw new Error('Save failed')
        return res.json()
      })
      .then((data: AppSettings) => {
        setSettings(data)
        setSaveState('saved')
        setTimeout(() => setSaveState('idle'), 2500)
      })
      .catch(() => setSaveState('idle'))
  }

  return (
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Settings</h1>
          <p className="app-section-sub">
            {loading ? 'Loading…' : error ? 'Could not reach the signals backend' : 'Live pipeline configuration — changes apply within ~10s, no restart needed'}
          </p>
        </div>
      </div>

      <div className="sig-panel" style={{ maxWidth: 560 }}>
        {error && (
          <div style={{ color: '#ff3b5c', padding: '0 0 20px', fontSize: '0.875rem' }}>{error}</div>
        )}

        {!loading && !error && (
          <>
            <div style={{ marginBottom: 24 }}>
              <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Roster size (top N traders by best_pnl)</div>
              <input
                className="sig-watch-input"
                type="number"
                min={1}
                max={2000}
                value={settings.roster_size}
                onChange={e => setSettings(s => ({ ...s, roster_size: Number(e.target.value) }))}
              />
            </div>

            <div style={{ marginBottom: 24 }}>
              <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Conviction tiers ($)</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {settings.tiers.map((t, i) => (
                  <input
                    key={i}
                    className="sig-watch-input"
                    type="number"
                    min={0}
                    value={t}
                    onChange={e => setTier(i, Number(e.target.value))}
                  />
                ))}
              </div>
            </div>

            <div style={{ marginBottom: 24 }}>
              <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Ticker minimum ($) — trades below this are ignored entirely</div>
              <input
                className="sig-watch-input"
                type="number"
                min={1}
                value={settings.ticker_min_usd}
                onChange={e => setSettings(s => ({ ...s, ticker_min_usd: Number(e.target.value) }))}
              />
            </div>

            <div style={{ marginBottom: 28 }}>
              <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Scalp window (minutes) — buy→sell faster than this counts as a scalp, not a genuine exit</div>
              <input
                className="sig-watch-input"
                type="number"
                min={1}
                value={settings.scalp_window_minutes}
                onChange={e => setSettings(s => ({ ...s, scalp_window_minutes: Number(e.target.value) }))}
              />
            </div>

            <button className="sig-btn" onClick={save} disabled={saveState === 'saving'}>
              {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved ✓' : 'Save settings'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

const demos: Record<string, () => JSX.Element> = {
  signals:     SignalsDemo,
  profits:     ProfitsPage,
  leaderboard: LeaderboardPage,
  alerts:      AlertsPage,
  settings:    SettingsPage,
}

/* ── App Shell ── */
export default function AppShell() {
  const navigate = useNavigate()
  const [active, setActive] = useState('signals')
  const [selectedWallet, setSelectedWallet] = useState<string | null>(null)
  const [user, setUser] = useState<User | null>(null)

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

  let page: JSX.Element
  if (selectedWallet) {
    page = <TraderDetailPage wallet={selectedWallet} onBack={() => setSelectedWallet(null)} />
  } else if (active === 'leaderboard') {
    page = <LeaderboardPage onSelectWallet={setSelectedWallet} />
  } else {
    const Demo = demos[active]
    page = <Demo />
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-sidebar-logo">VisibleTrader</div>
        <nav className="app-sidebar-nav">
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
        </nav>

        {user && (
          <div className="app-sidebar-bottom">
            <div className="app-user-row">
              <div className="app-avatar">{(user.email ?? '?')[0].toUpperCase()}</div>
              <div className="app-user-name" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user.email}</div>
            </div>
            <button className="app-nav-item" style={{ color: '#f87171' }} onClick={signOut}>Sign out</button>
          </div>
        )}
      </aside>

      <main className="app-main">
        {page}
      </main>
    </div>
  )
}
