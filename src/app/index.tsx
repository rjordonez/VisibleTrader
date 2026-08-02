import { useState, useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, BarChart2, Bell, Radar, Settings, Search, Home } from 'lucide-react'
import { supabase, isProdDb } from '../lib/supabase'
import type { User } from '@supabase/supabase-js'
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
  best_win_rate: number
  best_bet_ratio: number
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
  is_scalp: boolean | null
  market_closed: boolean | null
  resolved_win: boolean | null
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
  roster_tagged: boolean
  category: string | null
  ts: string
}

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

function SignalsDemo({ category }: { category: string }) {
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
  const [todayOnly, setTodayOnly]         = useState(false)
  const [sortMode, setSortMode]           = useState<'recent' | 'profit'>('recent')
  const [minWinRate, setMinWinRate]       = useState(0)
  const [minBetRatio, setMinBetRatio]     = useState(0)
  const [minPrice, setMinPrice]           = useState(0)
  const [maxPrice, setMaxPrice]           = useState(100)
  const [winRateMap, setWinRateMap]       = useState<Map<string, number>>(new Map())
  const [balanceMap, setBalanceMap]       = useState<Map<string, number>>(new Map())

  useEffect(() => {
    let cancelled = false
    const load = () => {
      Promise.resolve(supabase.from('opportunities_live').select('*').order('last_updated', { ascending: false }))
        .then(({ data, error }) => {
          if (cancelled) return
          if (error) throw error
          setOpportunities((data ?? []) as Opportunity[])
          setLoading(false)
          setError(null)
        })
        .catch((e: Error) => {
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
      Promise.resolve(supabase.from('ticker').select('*').order('epoch', { ascending: false }).limit(200))
        .then(({ data }) => { if (!cancelled) setTicker((data ?? []) as TickerTrade[]) })
        .catch(() => {})
    }
    load()
    const interval = setInterval(load, 3000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  // Win rate / wallet-balance data for the two threshold filters below —
  // both change slowly (win rate only moves on resolution, balance only on
  // the ~15min backend refresh), so this polls far less often than the
  // ticker/opportunities feeds.
  useEffect(() => {
    let cancelled = false
    const load = () => {
      Promise.all([
        Promise.resolve(supabase.from('leaderboard').select('wallet, won, lost')),
        Promise.resolve(supabase.from('wallet_balances').select('wallet, usdc_balance')),
      ]).then(([lb, wb]) => {
        if (cancelled) return
        const wr = new Map<string, number>()
        for (const r of (lb.data ?? []) as { wallet: string; won: number; lost: number }[]) {
          const total = r.won + r.lost
          if (total > 0) wr.set(r.wallet, r.won / total)
        }
        setWinRateMap(wr)
        const bal = new Map<string, number>()
        for (const r of (wb.data ?? []) as { wallet: string; usdc_balance: number | null }[]) {
          if (r.usdc_balance != null && r.usdc_balance > 0) bal.set(r.wallet, r.usdc_balance)
        }
        setBalanceMap(bal)
      }).catch(() => {})
    }
    load()
    const interval = setInterval(load, 60000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  const fetchWallets = (conditionId: string, outcome: string) =>
    Promise.resolve(
      supabase.from('wallet_positions').select('*')
        .eq('condition_id', conditionId).eq('outcome', outcome)
        .order('ts', { ascending: false })
    ).then(({ data }) => (data ?? []) as WalletContribution[]).catch(() => [] as WalletContribution[])

  const fetchChart = (conditionId: string, outcome: string) =>
    supabase.functions.invoke('price-chart', { body: { condition_id: conditionId, outcome } })
      .then(({ data }) => (data as { history: ChartPoint[] } | null)?.history || [])
      .catch(() => [] as ChartPoint[])

  const toggleExpand = (o: Opportunity) => {
    const key = `${o.condition_id}::${o.outcome}`
    if (expanded === key) {
      setExpanded(null)
      return
    }
    setExpanded(key)
    setWalletsLoading(true)
    setChartLoading(true)
    fetchWallets(o.condition_id, o.outcome).then(setWallets).finally(() => setWalletsLoading(false))
    fetchChart(o.condition_id, o.outcome).then(setChartHistory).finally(() => setChartLoading(false))
  }

  const byCategory = <T extends { category: string | null }>(list: T[]) =>
    category === 'all' ? list : list.filter(x => (x.category ?? 'other') === category)

  const filteredTicker = byCategory(ticker)
    .filter(t => !todayOnly || isToday(t.ts))
    .filter(t => {
      if (minWinRate === 0) return true
      const wr = t.wallet ? winRateMap.get(t.wallet) : undefined
      return wr !== undefined && wr * 100 >= minWinRate
    })
    .filter(t => {
      if (minBetRatio === 0) return true
      const bal = t.wallet ? balanceMap.get(t.wallet) : undefined
      return bal !== undefined && (t.usd / bal) * 100 >= minBetRatio
    })
    .filter(t => {
      const cents = t.price * 100
      return cents >= minPrice && cents <= maxPrice
    })
  const filteredOpportunities = byCategory(opportunities)
    .filter(o => !todayOnly || isToday(o.first_seen))
    .filter(o => minWinRate === 0 || o.best_win_rate * 100 >= minWinRate)
    .filter(o => minBetRatio === 0 || o.best_bet_ratio * 100 >= minBetRatio)
    .filter(o => {
      const cents = o.latest_price * 100
      return cents >= minPrice && cents <= maxPrice
    })
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
          </div>

          <div className="sig-chips" style={{ marginTop: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--text-faint)', marginRight: 2, alignSelf: 'center' }}>Win rate</span>
            {[0, 50, 65, 80].map(v => (
              <div key={v} className={minWinRate === v ? 'sig-chip active' : 'sig-chip'} onClick={() => setMinWinRate(v)}>
                {v === 0 ? 'Any' : `${v}%+`}
              </div>
            ))}
          </div>

          <div className="sig-chips" style={{ marginTop: 6 }}>
            <span style={{ fontSize: 11, color: 'var(--text-faint)', marginRight: 2, alignSelf: 'center' }}>Bet vs wallet balance</span>
            {[0, 5, 15, 30].map(v => (
              <div key={v} className={minBetRatio === v ? 'sig-chip active' : 'sig-chip'} onClick={() => setMinBetRatio(v)}>
                {v === 0 ? 'Any' : `${v}%+`}
              </div>
            ))}
          </div>

          <div className="sig-price-range" style={{ marginTop: 10 }}>
            <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
              Price range: {minPrice}¢ – {maxPrice}¢
            </span>
            <div className="sig-range-track-wrap">
              <div className="sig-range-track" />
              <div className="sig-range-fill" style={{ left: `${minPrice}%`, right: `${100 - maxPrice}%` }} />
              <input
                type="range" min={0} max={100} value={minPrice}
                onChange={e => setMinPrice(Math.min(Number(e.target.value), maxPrice - 1))}
                className="sig-range-input"
              />
              <input
                type="range" min={0} max={100} value={maxPrice}
                onChange={e => setMaxPrice(Math.max(Number(e.target.value), minPrice + 1))}
                className="sig-range-input"
              />
            </div>
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
                      {t.wallet && winRateMap.has(t.wallet) && (
                        <span>· {Math.round((winRateMap.get(t.wallet) ?? 0) * 100)}% win rate</span>
                      )}
                      {t.wallet && balanceMap.has(t.wallet) && (
                        <span>· {Math.round((t.usd / (balanceMap.get(t.wallet) ?? 1)) * 100)}% of wallet</span>
                      )}
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
                      {o.best_win_rate > 0 && (
                        <div className="sig-stat"><span className="sig-stat-label">Best win rate</span><span className="sig-stat-val">{Math.round(o.best_win_rate * 100)}%</span></div>
                      )}
                      {o.best_bet_ratio > 0 && (
                        <div className="sig-stat"><span className="sig-stat-label">Best bet ratio</span><span className="sig-stat-val">{Math.round(o.best_bet_ratio * 100)}%</span></div>
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

/* ── Home (Polymarket-homepage-style overview: hero + top movers + grid) ── */
function HomePage({ onOpenSignals, category }: { onOpenSignals: () => void; category: string }) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [heroWallets, setHeroWallets] = useState<WalletContribution[]>([])
  const [heroChartHistory, setHeroChartHistory] = useState<ChartPoint[]>([])
  const [heroLoading, setHeroLoading] = useState(false)
  const [heroIndex, setHeroIndex] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      Promise.resolve(supabase.from('opportunities_live').select('*').order('last_updated', { ascending: false }))
        .then(({ data, error: err }) => {
          if (cancelled) return
          if (err) throw err
          setOpportunities((data ?? []) as Opportunity[])
          setLoading(false)
          setError(null)
        })
        .catch((e: Error) => {
          if (cancelled) return
          setError(e.message)
          setLoading(false)
        })
    }
    load()
    const interval = setInterval(load, 5000)
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  const byCategory = <T extends { category: string | null }>(list: T[]) =>
    category === 'all' ? list : list.filter(x => (x.category ?? 'other') === category)

  const rankedByConviction = byCategory([...opportunities].sort((a, b) => b.cumulative_usd - a.cumulative_usd))
  // Hero rotates through the top 5 signals every few seconds (matching the
  // reference's carousel) instead of sitting on one static market forever.
  const heroPool = rankedByConviction.slice(0, 5)
  const heroSignal = heroPool[heroIndex % Math.max(1, heroPool.length)] ?? null
  const heroKey = heroSignal ? `${heroSignal.condition_id}::${heroSignal.outcome}` : null
  const topMovers = rankedByConviction.filter(o => `${o.condition_id}::${o.outcome}` !== heroKey).slice(0, 7)
  const gridItems = rankedByConviction.filter(o => `${o.condition_id}::${o.outcome}` !== heroKey).slice(0, 24)
  // Smart Plays: not just biggest $ (that's Top Movers) — multiple traders
  // converging on the same side AND actually in the green right now.
  const smartPlays = rankedByConviction
    .filter(o => `${o.condition_id}::${o.outcome}` !== heroKey && o.wallet_count >= 2 && o.total_profit > 0)
    .sort((a, b) => b.total_profit - a.total_profit)
    .slice(0, 5)

  useEffect(() => {
    if (heroPool.length < 2) return
    const t = setInterval(() => setHeroIndex(i => (i + 1) % heroPool.length), 6000)
    return () => clearInterval(t)
  }, [heroPool.length])

  useEffect(() => {
    if (!heroSignal) return
    let cancelled = false
    setHeroLoading(true)
    Promise.all([
      Promise.resolve(
        supabase.from('wallet_positions').select('*')
          .eq('condition_id', heroSignal.condition_id).eq('outcome', heroSignal.outcome)
          .order('ts', { ascending: false })
      ).then(({ data }) => (data ?? []) as WalletContribution[]).catch(() => [] as WalletContribution[]),
      supabase.functions.invoke('price-chart', { body: { condition_id: heroSignal.condition_id, outcome: heroSignal.outcome } })
        .then(({ data }) => (data as { history: ChartPoint[] } | null)?.history || [])
        .catch(() => [] as ChartPoint[]),
    ]).then(([w, c]) => {
      if (cancelled) return
      setHeroWallets(w)
      setHeroChartHistory(c)
      setHeroLoading(false)
    })
    return () => { cancelled = true }
  }, [heroKey])

  return (
    <div className="sig-page">

      {!loading && !error && heroSignal && (
        <div className="sig-hero-row">
          <div className="sig-hero">
            {(() => {
              const ic = categoryIcon(heroSignal.category)
              const tag = signalsTag(heroSignal.tier, heroSignal.cumulative_usd)
              return (
                <>
                  <div className="sig-hero-top">
                    <div className="sig-card-icon" style={{ background: ic.bg, width: 44, height: 44, fontSize: 20 }}>{ic.emoji}</div>
                    <div style={{ flex: 1 }}>
                      <div className="sig-hero-q">{heroSignal.title} <span className="sig-out">— {heroSignal.outcome}</span></div>
                      <div className="sig-card-meta">{heroSignal.wallet_count} top trader{heroSignal.wallet_count > 1 ? 's' : ''} · <span className={`sig-tag ${tag.cls}`} style={{ marginTop: 0 }}>{tag.label}</span></div>
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 700, color: heroSignal.total_profit >= 0 ? '#00d17a' : '#ff3b5c', flexShrink: 0 }}>
                      {fmtSigned(heroSignal.total_profit)}
                    </div>
                  </div>

                  <div className="sig-stats-row" style={{ margin: '16px 0' }}>
                    <div className="sig-stat-cell">
                      <div className="sig-stat-cell-label">Price</div>
                      <div className="sig-stat-cell-val">{Math.round(heroSignal.latest_price * 100)}¢</div>
                    </div>
                    <div className="sig-stat-cell">
                      <div className="sig-stat-cell-label">Total Deployed</div>
                      <div className="sig-stat-cell-val g">{fmtFull(heroSignal.cumulative_usd)}</div>
                    </div>
                    <div className="sig-stat-cell">
                      <div className="sig-stat-cell-label">Traders</div>
                      <div className="sig-stat-cell-val">{heroSignal.wallet_count}</div>
                    </div>
                    <div className="sig-stat-cell">
                      <div className="sig-stat-cell-label">Total Profit</div>
                      <div className={`sig-stat-cell-val ${heroSignal.total_profit >= 0 ? 'g' : 'r'}`}>{fmtSigned(heroSignal.total_profit)}</div>
                    </div>
                  </div>

                  <div className="sig-drill-label">Price history — dots mark each trader's buy-in</div>
                  <div style={{ minHeight: 220, marginBottom: 16 }}>
                    {heroLoading && <div className="sig-skel" style={{ height: 220 }} />}
                    {!heroLoading && heroChartHistory.length < 2 && (
                      <div style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>No price history available for this market.</div>
                    )}
                    {!heroLoading && heroChartHistory.length >= 2 && (
                      <PriceChart history={heroChartHistory} wallets={heroWallets} />
                    )}
                  </div>

                  <div className="sig-drill-label">Contributing traders</div>
                  <div style={{ minHeight: 5 * 36 }}>
                    {heroLoading && [0, 1, 2, 3, 4].map(i => (
                      <div key={i} className="sig-skel-row">
                        <div className="sig-skel" style={{ width: 100, height: 12 }} />
                        <div className="sig-skel" style={{ flex: 1, height: 12 }} />
                        <div className="sig-skel" style={{ width: 60, height: 12 }} />
                      </div>
                    ))}
                    {!heroLoading && heroWallets.length === 0 && (
                      <div style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>No contributor detail available.</div>
                    )}
                    {!heroLoading && heroWallets.slice(0, 5).map((w, i) => {
                    const st = signalsTraderStatus(w)
                    const ret = walletReturn(w, heroSignal.latest_price)
                    return (
                      <div key={i} className="sig-drill-row">
                        <a href={profileUrl(w.wallet)!} target="_blank" rel="noopener noreferrer" className="sig-drill-name">
                          {traderLabel(w.wallet, w.wallet_name)}
                        </a>
                        <div className="sig-drill-detail">{fmtFull(w.usd)} at {Math.round(w.price * 100)}¢ · {timeAgo(w.ts)}</div>
                        <div style={{ fontSize: 11.5, fontWeight: 700, color: ret.profit >= 0 ? '#00d17a' : '#ff3b5c', flexShrink: 0 }}>
                          {fmtSigned(ret.profit)}{!ret.realized ? ' (unrealized)' : ''}
                        </div>
                        <div className="sig-drill-status" style={{ color: st.color, background: st.color + '26' }}>{st.label}</div>
                      </div>
                    )
                  })}
                  </div>
                </>
              )
            })()}

            {heroPool.length > 1 && (
              <div className="sig-hero-dots">
                {heroPool.map((o, i) => (
                  <span
                    key={`${o.condition_id}::${o.outcome}`}
                    className={i === heroIndex % heroPool.length ? 'active' : ''}
                    onClick={() => setHeroIndex(i)}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="sig-sidebar-col">
            <div className="sig-movers">
              <div className="sig-movers-label">Top movers by conviction $</div>
              {topMovers.map(o => {
                const ic = categoryIcon(o.category)
                return (
                  <div key={`${o.condition_id}::${o.outcome}`} className="sig-mover-row">
                    <div className="sig-card-icon" style={{ background: ic.bg, width: 28, height: 28, fontSize: 13, flexShrink: 0 }}>{ic.emoji}</div>
                    <div className="sig-mover-title">{o.title} <span className="sig-out">— {o.outcome}</span></div>
                    <div className="sig-mover-amt">{fmtFull(o.cumulative_usd)}</div>
                  </div>
                )
              })}
            </div>

            {smartPlays.length > 0 && (
              <div className="sig-movers" style={{ flex: 1 }}>
                <div className="sig-movers-label">Smart plays — multiple traders, in the green</div>
                {smartPlays.map(o => {
                  const ic = categoryIcon(o.category)
                  return (
                    <div key={`${o.condition_id}::${o.outcome}`} className="sig-mover-row">
                      <div className="sig-card-icon" style={{ background: ic.bg, width: 28, height: 28, fontSize: 13, flexShrink: 0 }}>{ic.emoji}</div>
                      <div className="sig-mover-title">{o.title} <span className="sig-out">— {o.outcome}</span></div>
                      <div className="sig-mover-amt">{fmtSigned(o.total_profit)}</div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      <div className="sig-panel" style={{ maxWidth: 'none' }}>
        <div className="app-section-header" style={{ marginBottom: 12 }}>
          <div>
            <h1 className="app-section-title" style={{ fontSize: '1.05rem' }}>All signals</h1>
          </div>
          <button className="sig-btn secondary" onClick={onOpenSignals}>Open full Signals page →</button>
        </div>

        {loading && <div className="sig-empty">Connecting to the live signal feed…</div>}
        {!loading && !error && gridItems.length === 0 && (
          <div className="sig-empty">No opportunities detected yet.</div>
        )}
        <div className="sig-grid-dense">
          {gridItems.map(o => {
            const ic = categoryIcon(o.category)
            const tag = signalsTag(o.tier, o.cumulative_usd)
            return (
              <div key={`${o.condition_id}::${o.outcome}`} className="sig-card sig-card-dense" onClick={onOpenSignals}>
                <div className="sig-card-top" style={{ marginBottom: 10 }}>
                  <div className="sig-card-icon" style={{ background: ic.bg, width: 28, height: 28, fontSize: 13 }}>{ic.emoji}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="sig-card-q" style={{ fontSize: 12.5, WebkitLineClamp: 2, display: '-webkit-box', WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {o.title} <span className="sig-out">— {o.outcome}</span>
                    </div>
                  </div>
                </div>
                <div className="sig-stat"><span className="sig-stat-label">Price</span><span className="sig-stat-val">{Math.round(o.latest_price * 100)}¢</span></div>
                <div className="sig-stat"><span className="sig-stat-label">Total</span><span className="sig-stat-val g">{fmtFull(o.cumulative_usd)}</span></div>
                <div className="sig-stat"><span className="sig-stat-label">Profit</span><span className={`sig-stat-val ${o.total_profit >= 0 ? 'g' : 'r'}`}>{fmtSigned(o.total_profit)}</span></div>
                <div className={`sig-tag ${tag.cls}`} style={{ marginTop: 10 }}>{tag.label}</div>
              </div>
            )
          })}
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
  resolved_win: boolean
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
      Promise.all([
        supabase.from('profits_summary').select('*').single(),
        supabase.from('profits_daily').select('*').order('d', { ascending: true }),
        supabase.from('wallet_positions').select('*').eq('market_closed', true).order('resolved_ts', { ascending: false }).limit(200),
      ])
        .then(([summaryRes, dailyRes, positionsRes]) => {
          if (cancelled) return
          if (summaryRes.error) throw summaryRes.error
          if (dailyRes.error) throw dailyRes.error
          if (positionsRes.error) throw positionsRes.error
          setSummary((summaryRes.data ?? null) as ProfitsSummary | null)
          setDaily((dailyRes.data ?? []) as ProfitsDaily[])
          setPositions((positionsRes.data ?? []) as ProfitsPosition[])
          setLoading(false)
          setError(null)
        })
        .catch((e: Error) => {
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
      Promise.resolve(supabase.from('leaderboard').select('*').order('net_profit', { ascending: false }))
        .then(({ data, error }) => {
          if (cancelled) return
          if (error) throw error
          setRows((data ?? []) as LeaderboardRow[])
          setLoading(false)
          setError(null)
        })
        .catch((e: Error) => {
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
  resolved_win: boolean
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

interface LivePosition {
  title: string
  outcome: string
  curPrice: number
  avgPrice: number
  cashPnl: number
  realizedPnl: number
  redeemable: boolean
}

interface LiveClosedPosition {
  title: string
  outcome: string
  avgPrice: number
  curPrice: number
  realizedPnl: number
  timestamp: number
}

interface LiveTrade {
  timestamp: number
  side: string
  title: string
  outcome: string
  size: number
  price: number
}

function TraderDetailPage({ wallet, onBack }: { wallet: string; onBack: () => void }) {
  const [summary, setSummary] = useState<TraderSummary | null>(null)
  const [positions, setPositions] = useState<TraderPosition[]>([])
  const [byCategory, setByCategory] = useState<TraderCategoryStat[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [livePositions, setLivePositions] = useState<LivePosition[]>([])
  const [liveClosed, setLiveClosed] = useState<LiveClosedPosition[]>([])
  const [liveTrades, setLiveTrades] = useState<LiveTrade[]>([])
  const [liveLoading, setLiveLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLivePositions([])
    setLiveClosed([])
    setLiveTrades([])
    Promise.all([
      supabase.from('leaderboard').select('*').ilike('wallet', wallet).maybeSingle(),
      supabase.from('wallet_positions').select('*').ilike('wallet', wallet).eq('market_closed', true).order('resolved_ts', { ascending: false }),
      supabase.from('wallet_category_breakdown').select('*').ilike('wallet', wallet).order('profit', { ascending: false }),
    ])
      .then(([summaryRes, positionsRes, categoryRes]) => {
        if (cancelled) return
        if (summaryRes.error) throw summaryRes.error
        if (positionsRes.error) throw positionsRes.error
        if (categoryRes.error) throw categoryRes.error
        const summaryData = (summaryRes.data ?? null) as TraderSummary | null
        setSummary(summaryData)
        setPositions((positionsRes.data ?? []) as TraderPosition[])
        setByCategory((categoryRes.data ?? []) as TraderCategoryStat[])
        setLoading(false)
        setError(null)

        // We only have history for wallets we've tracked ourselves — for
        // everyone else, fall back to Polymarket's own public (CORS-open,
        // no auth needed) data API so "no tracked history" doesn't mean
        // "we can't show you anything real about this wallet."
        if (!summaryData) {
          setLiveLoading(true)
          Promise.all([
            fetch(`https://data-api.polymarket.com/positions?user=${wallet}&limit=50`).then(r => r.ok ? r.json() : []),
            fetch(`https://data-api.polymarket.com/closed-positions?user=${wallet}&limit=200`).then(r => r.ok ? r.json() : []),
            fetch(`https://data-api.polymarket.com/trades?user=${wallet}&limit=30`).then(r => r.ok ? r.json() : []),
          ])
            .then(([pos, closed, trades]) => {
              if (cancelled) return
              setLivePositions((pos ?? []) as LivePosition[])
              setLiveClosed((closed ?? []) as LiveClosedPosition[])
              setLiveTrades((trades ?? []) as LiveTrade[])
            })
            .catch(() => {})
            .finally(() => { if (!cancelled) setLiveLoading(false) })
        }
      })
      .catch((e: Error) => {
        if (cancelled) return
        setError(e.message)
        setLoading(false)
      })
    return () => { cancelled = true }
  }, [wallet])

  const winRate = summary && summary.won + summary.lost > 0 ? (summary.won / (summary.won + summary.lost)) * 100 : 0
  const usdWinRate = summary && summary.deployed > 0 ? (summary.won_usd / summary.deployed) * 100 : 0
  const roi = summary && summary.deployed > 0 ? (summary.net_profit / summary.deployed) * 100 : 0

  // Live-fallback stats, computed the same way check_market_closed already
  // does server-side: a resolved outcome settles at 0 or 1, so curPrice >= 0.5
  // means that side won.
  const liveWon = liveClosed.filter(p => p.curPrice >= 0.5).length
  const liveWinRate = liveClosed.length > 0 ? (liveWon / liveClosed.length) * 100 : 0
  const liveRealizedPnl = liveClosed.reduce((sum, p) => sum + p.realizedPnl, 0)
  const liveCumulative = [...liveClosed]
    .sort((a, b) => a.timestamp - b.timestamp)
    .reduce<{ d: string; cum: number }[]>((acc, p) => {
      const prevCum = acc.length > 0 ? acc[acc.length - 1].cum : 0
      acc.push({ d: String(p.timestamp), cum: prevCum + p.realizedPnl })
      return acc
    }, [])

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
          <>
            <div className="sig-empty" style={{ marginBottom: 20 }}>
              Not in our tracked history yet — showing live data straight from Polymarket instead.
            </div>

            {liveLoading && <div className="sig-empty">Loading from Polymarket…</div>}

            {!liveLoading && (livePositions.length > 0 || liveClosed.length > 0) && (
              <>
                <div className="sig-stats-row">
                  <div className="sig-stat-cell">
                    <div className="sig-stat-cell-label">Realized P&L</div>
                    <div className={`sig-stat-cell-val ${liveRealizedPnl >= 0 ? 'g' : 'r'}`}>{fmtSigned(liveRealizedPnl)}</div>
                  </div>
                  <div className="sig-stat-cell">
                    <div className="sig-stat-cell-label" title="Winning closed positions ÷ total closed positions">Win Rate</div>
                    <div className="sig-stat-cell-val">{liveWinRate.toFixed(0)}%</div>
                  </div>
                  <div className="sig-stat-cell">
                    <div className="sig-stat-cell-label">Current Positions</div>
                    <div className="sig-stat-cell-val">{livePositions.length}</div>
                  </div>
                  <div className="sig-stat-cell">
                    <div className="sig-stat-cell-label">Total Positions</div>
                    <div className="sig-stat-cell-val">{livePositions.length + liveClosed.length}</div>
                  </div>
                </div>

                {liveCumulative.length > 1 && (
                  <>
                    <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Realized P&L over time (live from Polymarket)</div>
                    <div style={{ marginBottom: 24 }}>
                      <CumulativeChart data={liveCumulative} />
                    </div>
                  </>
                )}
              </>
            )}

            {!liveLoading && livePositions.length > 0 && (
              <>
                <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Current positions (live from Polymarket)</div>
                <div className="sig-table-wrap" style={{ marginBottom: 24 }}>
                  <table className="sig-table">
                    <thead>
                      <tr><th>Market</th><th className="num">Avg Price</th><th className="num">Current Price</th><th className="num">Unrealized P&L</th></tr>
                    </thead>
                    <tbody>
                      {livePositions.map((p, i) => (
                        <tr key={i}>
                          <td>{p.title} <span style={{ color: 'var(--text-dim)' }}>— {p.outcome}</span></td>
                          <td className="num">{Math.round(p.avgPrice * 100)}¢</td>
                          <td className="num">{Math.round(p.curPrice * 100)}¢</td>
                          <td className="num" style={{ color: p.cashPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(p.cashPnl)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {!liveLoading && liveClosed.length > 0 && (
              <>
                <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Closed positions (live from Polymarket)</div>
                <div className="sig-table-wrap" style={{ marginBottom: 24 }}>
                  <table className="sig-table">
                    <thead>
                      <tr><th>Market</th><th>Result</th><th className="num">Profit</th><th className="num">Resolved</th></tr>
                    </thead>
                    <tbody>
                      {[...liveClosed].sort((a, b) => b.timestamp - a.timestamp).map((p, i) => (
                        <tr key={i}>
                          <td>{p.title} <span style={{ color: 'var(--text-dim)' }}>— {p.outcome}</span></td>
                          <td style={{ color: p.curPrice >= 0.5 ? 'var(--green)' : 'var(--red)' }}>{p.curPrice >= 0.5 ? 'Won' : 'Lost'}</td>
                          <td className="num" style={{ color: p.realizedPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(p.realizedPnl)}</td>
                          <td className="num" style={{ color: 'var(--text-dim)' }}>{timeAgo(new Date(p.timestamp * 1000).toISOString())}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {!liveLoading && liveTrades.length > 0 && (
              <>
                <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Recent trades (live from Polymarket)</div>
                <div className="sig-table-wrap">
                  <table className="sig-table">
                    <thead>
                      <tr><th>Market</th><th>Side</th><th className="num">Size</th><th className="num">Price</th><th className="num">When</th></tr>
                    </thead>
                    <tbody>
                      {liveTrades.map((t, i) => (
                        <tr key={i}>
                          <td>{t.title} <span style={{ color: 'var(--text-dim)' }}>— {t.outcome}</span></td>
                          <td style={{ color: t.side === 'BUY' ? 'var(--green)' : 'var(--red)' }}>{t.side}</td>
                          <td className="num">{t.size.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                          <td className="num">{Math.round(t.price * 100)}¢</td>
                          <td className="num" style={{ color: 'var(--text-dim)' }}>{timeAgo(new Date(t.timestamp * 1000).toISOString())}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {!liveLoading && livePositions.length === 0 && liveClosed.length === 0 && liveTrades.length === 0 && (
              <div className="sig-empty">Nothing found for this wallet on Polymarket either.</div>
            )}
          </>
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
      Promise.resolve(supabase.from('ticker').select('*').order('epoch', { ascending: false }).limit(200))
        .then(({ data }) => {
          if (cancelled) return
          for (const t of (data ?? []) as TickerTrade[]) {
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
      Promise.resolve(supabase.from('opportunities_live').select('*').order('last_updated', { ascending: false }))
        .then(({ data }) => {
          if (cancelled) return
          for (const o of (data ?? []) as Opportunity[]) {
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
    Promise.resolve(
      supabase.from('app_settings').select('roster_size, tiers, ticker_min_usd, scalp_window_minutes').eq('id', 1).single()
    )
      .then(({ data, error }) => {
        if (error) throw error
        setSettings(data as AppSettings)
        setLoading(false)
      })
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }, [])

  const setTier = (i: number, value: number) => {
    setSettings(s => ({ ...s, tiers: s.tiers.map((t, idx) => (idx === i ? value : t)) }))
  }

  const save = () => {
    setSaveState('saving')
    // No server in the loop anymore to sanitize this before it hits the table
    // the Python service trusts — same clamping the old proxy did, now here.
    const tiers = [...new Set(settings.tiers.map(Number).filter(n => Number.isFinite(n) && n >= 0))].sort((a, b) => a - b)
    const cfg: AppSettings = {
      roster_size: Math.max(1, Math.min(2000, Math.round(Number(settings.roster_size)) || SETTINGS_DEFAULT.roster_size)),
      tiers: tiers.length > 0 ? tiers : SETTINGS_DEFAULT.tiers,
      ticker_min_usd: Math.max(1, Math.round(Number(settings.ticker_min_usd)) || SETTINGS_DEFAULT.ticker_min_usd),
      scalp_window_minutes: Math.max(1, Math.round(Number(settings.scalp_window_minutes)) || SETTINGS_DEFAULT.scalp_window_minutes),
    }
    Promise.resolve(
      supabase.from('app_settings').update(cfg).eq('id', 1)
        .select('roster_size, tiers, ticker_min_usd, scalp_window_minutes').single()
    )
      .then(({ data, error }) => {
        if (error) throw error
        setSettings(data as AppSettings)
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

/* ── Lookup ── */
interface DirectoryResult {
  wallet: string
  username: string | null
  best_pnl: number | null
}

interface LookupStatus {
  manuallyTracked: boolean
  pnlRank: number | null
}

function LookupPage({ onSelectWallet }: { onSelectWallet: (wallet: string) => void }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<DirectoryResult[]>([])
  const [status, setStatus] = useState<Record<string, LookupStatus>>({})
  const [rosterSize, setRosterSize] = useState(500)
  const [userId, setUserId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyWallet, setBusyWallet] = useState<string | null>(null)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null))
    Promise.resolve(supabase.from('app_settings').select('roster_size').eq('id', 1).single())
      .then(({ data }) => { if (data) setRosterSize((data as { roster_size: number }).roster_size) })
      .catch(() => {})
  }, [])

  const loadStatus = (wallets: string[]) => {
    Promise.all([
      Promise.resolve(supabase.from('tracked_wallets').select('wallet').in('wallet', wallets)),
      Promise.all(wallets.map(w => Promise.resolve(supabase.rpc('wallet_pnl_rank', { target_wallet: w })))),
    ]).then(([trackedRes, rankResults]) => {
      const trackedSet = new Set(((trackedRes.data ?? []) as { wallet: string }[]).map(r => r.wallet))
      const next: Record<string, LookupStatus> = {}
      wallets.forEach((w, i) => {
        const rank = rankResults[i]?.data as number | null
        next[w] = { manuallyTracked: trackedSet.has(w), pnlRank: rank ?? null }
      })
      setStatus(next)
    }).catch(() => {})
  }

  const search = () => {
    const q = query.trim()
    if (!q) return
    setLoading(true)
    setError(null)
    Promise.resolve(
      supabase.from('wallet_directory').select('wallet, username, best_pnl')
        .or(`wallet.ilike.%${q}%,username.ilike.%${q}%`)
        .order('best_pnl', { ascending: false })
        .limit(20)
    )
      .then(({ data, error: err }) => {
        if (err) throw err
        const rows = (data ?? []) as DirectoryResult[]
        setResults(rows)
        setLoading(false)
        if (rows.length > 0) loadStatus(rows.map(r => r.wallet))
      })
      .catch((e: Error) => {
        setError(e.message)
        setLoading(false)
      })
  }

  const track = (wallet: string) => {
    setBusyWallet(wallet)
    Promise.resolve(
      supabase.from('tracked_wallets').upsert(
        { wallet, added_by: userId },
        { onConflict: 'wallet', ignoreDuplicates: true }
      )
    )
      .then(({ error: err }) => {
        if (err) throw err
        setStatus(s => ({ ...s, [wallet]: { ...s[wallet], manuallyTracked: true } }))
      })
      .catch(() => {})
      .finally(() => setBusyWallet(null))
  }

  const untrack = (wallet: string) => {
    setBusyWallet(wallet)
    Promise.resolve(supabase.from('tracked_wallets').delete().eq('wallet', wallet))
      .then(({ error: err }) => {
        if (err) throw err
        setStatus(s => ({ ...s, [wallet]: { ...s[wallet], manuallyTracked: false } }))
      })
      .catch(() => {})
      .finally(() => setBusyWallet(null))
  }

  return (
    <div className="sig-page">
      <div className="app-section-header">
        <div>
          <h1 className="app-section-title">Lookup</h1>
          <p className="app-section-sub">Search any wallet by address or username — track one that isn't already tracked</p>
        </div>
      </div>

      <div className="sig-panel">
        <div className="sig-watch-form" style={{ marginBottom: 20 }}>
          <input
            className="sig-watch-input"
            placeholder="Wallet address or username…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && search()}
          />
          <button className="sig-btn" onClick={search} disabled={loading}>{loading ? 'Searching…' : 'Search'}</button>
        </div>

        {error && <div style={{ color: '#ff3b5c', marginBottom: 20, fontSize: '0.875rem' }}>{error}</div>}
        {!loading && !error && results.length === 0 && <div className="sig-empty">No results yet — search above.</div>}

        {results.length > 0 && (
          <div className="sig-table-wrap">
            <table className="sig-table">
              <thead>
                <tr>
                  <th>Trader</th>
                  <th className="num">Best PnL</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {results.map(r => {
                  const s = status[r.wallet]
                  const inRoster = s && s.pnlRank !== null && s.pnlRank <= rosterSize
                  const tracked = inRoster || s?.manuallyTracked
                  return (
                    <tr key={r.wallet}>
                      <td>
                        <a href="#" onClick={e => { e.preventDefault(); onSelectWallet(r.wallet) }}>
                          {traderLabel(r.wallet, r.username)}
                        </a>
                        <a
                          href={profileUrl(r.wallet)!} target="_blank" rel="noopener noreferrer"
                          style={{ marginLeft: 6, color: 'var(--text-faint)', fontSize: 11 }}
                        >
                          ↗
                        </a>
                      </td>
                      <td className="num">{r.best_pnl != null ? fmtFull(r.best_pnl) : '—'}</td>
                      <td>
                        {!s ? '…' :
                          inRoster ? `Tracked · top ${s.pnlRank} by PnL` :
                          s.manuallyTracked ? 'Tracked · manually added' :
                          'Not tracked'}
                      </td>
                      <td>
                        {s && !tracked && (
                          userId ? (
                            <button className="sig-btn" disabled={busyWallet === r.wallet} onClick={() => track(r.wallet)}>
                              {busyWallet === r.wallet ? 'Adding…' : 'Track'}
                            </button>
                          ) : (
                            <span style={{ color: 'var(--text-dim)', fontSize: '0.8rem' }}>Log in to track</span>
                          )
                        )}
                        {s && s.manuallyTracked && userId && (
                          <span className="sig-watch-remove" onClick={() => untrack(r.wallet)}>Untrack</span>
                        )}
                      </td>
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
