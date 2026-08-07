import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Opportunity, WalletContribution, ChartPoint } from './types'
import {
  onTabVisible, byCategory, fetchWallets, fetchChart, PAGE_SIZE,
  categoryIcon, categoryLabel, signalsTag, fmtFull, fmtSigned, signalsTraderStatus, walletReturn,
  profileUrl, traderLabel, timeAgo, NAV_CATEGORIES,
} from './helpers'
import { PriceChart } from './PriceChart'
import { SkelHeroRow, SkelCardGrid } from './Skeleton'
import { SignalModal } from './SignalModal'

/* ── Home (Polymarket-homepage-style overview: hero + top movers + grid) ── */
function HomePage({ onOpenSignals, category, onCategoryChange }: {
  onOpenSignals: () => void
  category: string
  onCategoryChange: (category: string) => void
}) {
  const [opportunities, setOpportunities] = useState<Opportunity[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [heroIndex, setHeroIndex] = useState(0)
  const [modalOpp, setModalOpp] = useState<Opportunity | null>(null)
  // Every hero-carousel candidate's wallets/chart, keyed by condition_id::outcome,
  // fetched up front rather than one-at-a-time on rotation — the carousel advances
  // every 6s, and fetching only the newly-shown slot on each rotation produced a
  // visible blank/skeleton flash every single time.
  const [heroCache, setHeroCache] = useState<Map<string, { wallets: WalletContribution[]; chartHistory: ChartPoint[]; fetchedAt: number }>>(new Map())
  // Bumped on a timer purely to re-trigger the staleness-check effect below —
  // heroCache itself isn't a dependency there so a fresh cache entry doesn't
  // immediately retrigger a redundant re-check.
  const [heroCacheTick, setHeroCacheTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      Promise.resolve(supabase.from('opportunities_live').select('*')
        .order('last_updated', { ascending: false }).order('id', { ascending: false })
        .limit(PAGE_SIZE))
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
    // See SignalsDemo's identical pattern — opportunities_live is a view,
    // so Realtime subscribes to `opportunities` (the only base table that
    // needs watching, see SignalsDemo's fuller comment) instead and
    // re-fetches on any change, debounced (trailing-edge) since
    // mark-to-market ticks land on `opportunities` continuously across
    // ~1,400 tracked markets; the interval stays as a fallback.
    let debounceTimer: ReturnType<typeof setTimeout> | null = null
    const debouncedLoad = () => {
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(load, 1000)
    }
    const channel = supabase
      .channel('home-opportunities-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'opportunities' }, debouncedLoad)
      .subscribe()
    const interval = setInterval(load, 60000)
    const unsubVisible = onTabVisible(load)
    return () => {
      cancelled = true
      clearInterval(interval)
      if (debounceTimer) clearTimeout(debounceTimer)
      supabase.removeChannel(channel)
      unsubVisible()
    }
  }, [])

  // Hero / Top Movers / Smart Plays intentionally ignore the category filter —
  // only the "Signals" grid below is scoped to it.
  const sortedByConviction = [...opportunities].sort((a, b) => b.cumulative_usd - a.cumulative_usd)
  // Hero rotates through the top 5 signals every few seconds (matching the
  // reference's carousel) instead of sitting on one static market forever.
  const heroPool = sortedByConviction.slice(0, 5)
  const heroSignal = heroPool[heroIndex % Math.max(1, heroPool.length)] ?? null
  const heroKey = heroSignal ? `${heroSignal.condition_id}::${heroSignal.outcome}` : null
  const topMovers = sortedByConviction.filter(o => `${o.condition_id}::${o.outcome}` !== heroKey).slice(0, 7)
  const gridItems = byCategory(sortedByConviction, category)
    .filter(o => `${o.condition_id}::${o.outcome}` !== heroKey)
    .slice(0, 24)
  // Smart Plays: not just biggest $ (that's Top Movers) — multiple traders
  // converging on the same side AND actually in the green right now.
  const smartPlays = sortedByConviction
    .filter(o => `${o.condition_id}::${o.outcome}` !== heroKey && o.wallet_count >= 2 && o.total_profit > 0)
    .sort((a, b) => b.total_profit - a.total_profit)
    .slice(0, 5)

  useEffect(() => {
    if (heroPool.length < 2) return
    const advance = () => setHeroIndex(i => (i + 1) % heroPool.length)
    const t = setInterval(advance, 6000)
    const unsubVisible = onTabVisible(advance)
    return () => { clearInterval(t); unsubVisible() }
  }, [heroPool.length])

  const HERO_CACHE_TTL_MS = 30000
  const heroPoolKeys = heroPool.map(o => `${o.condition_id}::${o.outcome}`).join(',')

  useEffect(() => {
    let cancelled = false
    const stale = heroPool.filter(o => {
      const entry = heroCache.get(`${o.condition_id}::${o.outcome}`)
      return !entry || Date.now() - entry.fetchedAt > HERO_CACHE_TTL_MS
    })
    if (stale.length === 0) return
    Promise.all(stale.map(o => {
      const key = `${o.condition_id}::${o.outcome}`
      return Promise.all([
        fetchWallets(o.condition_id, o.outcome),
        fetchChart(o.condition_id, o.outcome),
      ]).then(([wallets, chartHistory]) => ({ key, wallets, chartHistory, fetchedAt: Date.now() }))
    })).then(results => {
      if (cancelled) return
      setHeroCache(prev => {
        const next = new Map(prev)
        for (const r of results) next.set(r.key, { wallets: r.wallets, chartHistory: r.chartHistory, fetchedAt: r.fetchedAt })
        return next
      })
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heroPoolKeys, heroCacheTick])

  // heroPoolKeys only changes when the top-5 set itself changes — this keeps
  // re-checking staleness on a timer so a slot that's been sitting in the
  // carousel gets refreshed in the background too, without ever clearing it.
  useEffect(() => {
    const recheck = () => setHeroCacheTick(v => v + 1)
    const t = setInterval(recheck, 10000)
    const unsubVisible = onTabVisible(recheck)
    return () => { clearInterval(t); unsubVisible() }
  }, [])

  const heroCacheEntry = heroKey ? heroCache.get(heroKey) : undefined
  const heroWallets = heroCacheEntry?.wallets ?? []
  const heroChartHistory = heroCacheEntry?.chartHistory ?? []
  const heroLoading = heroKey != null && !heroCacheEntry

  return (
    <div className="sig-page">

      {loading && !error && <SkelHeroRow />}

      {!loading && !error && heroSignal && (
        <div className="sig-hero-row">
          <div className="sig-hero">
            {(() => {
              const ic = categoryIcon(heroSignal.category)
              const tag = signalsTag(heroSignal.tier, heroSignal.cumulative_usd)
              return (
                <div key={heroKey} className="sig-hero-fade">
                  <div className="sig-hero-top">
                    <div className="sig-card-icon" style={{ background: ic.bg, width: 44, height: 44, fontSize: 20 }}>{ic.emoji}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
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
                </div>
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
            <h1 className="app-section-title" style={{ fontSize: '1.05rem', margin: 0 }}>Signals</h1>
            <div className="sig-cat-chips">
              <div
                className={category === 'all' ? 'sig-cat-chip active' : 'sig-cat-chip'}
                onClick={() => onCategoryChange('all')}
              >
                All
              </div>
              {NAV_CATEGORIES.map(c => (
                <div
                  key={c}
                  className={category === c ? 'sig-cat-chip active' : 'sig-cat-chip'}
                  onClick={() => onCategoryChange(c)}
                >
                  {categoryLabel(c)}
                </div>
              ))}
            </div>
          </div>
          <button className="sig-btn secondary" onClick={onOpenSignals}>Open full Signals page →</button>
        </div>

        {loading && <SkelCardGrid count={12} dense />}
        {!loading && !error && gridItems.length === 0 && (
          <div className="sig-empty">No opportunities detected yet.</div>
        )}
        <div className="sig-grid-dense">
          {gridItems.map(o => {
            const ic = categoryIcon(o.category)
            const tag = signalsTag(o.tier, o.cumulative_usd)
            return (
              <div key={`${o.condition_id}::${o.outcome}`} className="sig-card sig-card-dense" onClick={() => setModalOpp(o)}>
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

      {modalOpp && (
        <SignalModal
          key={`${modalOpp.condition_id}::${modalOpp.outcome}`}
          opportunity={modalOpp}
          onClose={() => setModalOpp(null)}
        />
      )}
    </div>
  )
}

export default HomePage
