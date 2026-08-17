import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { traderLabel, profileUrl, categoryLabel, fmtSigned, fmtFull, timeAgo } from './app/helpers'
import { appUrl, marketingUrl } from './lib/domains'
import { CumulativeChart } from './app/PriceChart'

// Public page (rendered outside ProtectedRoute — see App.tsx) at
// app.visibletrader.com/search, reachable while logged out. Deliberately
// its own visual design, not a copy of the authenticated LookupPage.tsx
// (a plain search-table utility) — this is a shareable, presentable page
// meant to convert a cold visitor. Data comes from the wallet-search Edge
// Function rather than direct Supabase queries: opportunity_wallets and
// everything built on it are RLS-gated behind an active subscription, so
// an anon client-side query would just come back empty — the function is
// the one place that decides, per-request, how much a given caller
// actually gets back (see supabase/functions/wallet-search/index.ts).
interface Headline { netProfit: number; winRate: number; roi: number; resolvedCount: number; rank: number | null }
interface Position { title: string; outcome: string; usd: number; price: number; resolved_win: boolean; resolved_ts: string; profit: number }
interface SimilarTrader { wallet: string; walletName: string | null; overlap: number; netProfit: number }
interface LivePosition { title: string; outcome: string; avgPrice: number; curPrice: number; cashPnl: number }
interface LiveClosed { title: string; outcome: string; curPrice: number; realizedPnl: number; timestamp: number }
interface CategoryRow { category: string; n: number; won: number; lost: number; profit: number }

interface SearchResult {
  tracked: boolean
  wallet: string
  walletName: string | null
  entitled: boolean
  headline: Headline | null
  positions: Position[] | null
  categoryBreakdown: CategoryRow[] | null
  similarTraders: SimilarTrader[] | null
  livePositions?: LivePosition[]
  liveClosed?: LiveClosed[]
}

// Plausible-looking placeholder rows for the blurred sections — never
// real data (the function withholds real position/similar-trader data
// entirely for a non-entitled caller), just enough visual weight that
// the blur reads as "real content underneath" like ProfitCard.tsx does.
const fakePositions = [
  { market: 'Fed rate decision — March', outcome: 'No cut', profit: '+$4,210' },
  { market: 'Champions League final', outcome: 'Real Madrid', profit: '+$1,830' },
  { market: 'CPI print — above 3.1%', outcome: 'Yes', profit: '-$620' },
]
const fakeSimilar = [
  { name: 'wallet_a7c…', overlap: '6 shared markets' },
  { name: 'trader_x92…', overlap: '4 shared markets' },
]

// Shared by both the tracked and untracked result branches below — same
// entitled/locked-preview treatment regardless of which path the wallet
// took, since the underlying data source doesn't change what's ours to gate.
function SimilarTradersSection({ entitled, similarTraders, signupHref }: {
  entitled: boolean
  similarTraders: SimilarTrader[] | null
  signupHref: string
}) {
  return (
    <>
      <div className="sig-stat-cell-label" style={{ marginBottom: 8, marginTop: 24 }}>Similar top traders</div>
      {entitled && similarTraders ? (
        similarTraders.length > 0 ? (
          <div className="sig-table-wrap">
            <table className="sig-table">
              <thead><tr><th>Trader</th><th className="num">Shared markets</th><th className="num">Their net P&L</th></tr></thead>
              <tbody>
                {similarTraders.map(t => (
                  <tr key={t.wallet}>
                    <td><a href={appUrl(`/search?wallet=${t.wallet}`)}>{traderLabel(t.wallet, t.walletName)}</a></td>
                    <td className="num">{t.overlap}</td>
                    <td className="num" style={{ color: t.netProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(t.netProfit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div className="sig-empty">No overlap with other tracked traders yet.</div>
      ) : (
        <div className="search-locked">
          <div className="search-locked-bg">
            <table className="sig-table">
              <thead><tr><th>Trader</th><th className="num">Shared markets</th></tr></thead>
              <tbody>
                {fakeSimilar.map((t, i) => (
                  <tr key={i}><td>{t.name}</td><td className="num">{t.overlap}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="search-glass-overlay">
            <p className="search-glass-title">Unlock which top traders are moving with this wallet</p>
            <a href={signupHref} className="search-glass-btn">Start 7-day free trial</a>
          </div>
        </div>
      )}
    </>
  )
}

// The single highest-leverage "summarize this trader at a glance" element —
// a trend line reads in one look, where a table of 50 rows doesn't. Guards
// its own length>1 case so callers can render it unconditionally.
function CumulativeChartSection({ data, label }: { data: { d: string; cum: number }[]; label: string }) {
  if (data.length < 2) return null
  return (
    <>
      <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>{label}</div>
      <div style={{ marginBottom: 24 }}>
        <CumulativeChart data={data} />
      </div>
    </>
  )
}

// Pure derivation from data already in memory — no new fetch, no backend
// change. Only ever called where real position-level data exists, same as
// CumulativeChartSection above: there's nothing to build a locked/fake
// version against, so this section simply doesn't render otherwise.
function HighlightsRow({ items }: { items: { title: string; outcome: string; profit: number }[] }) {
  if (items.length === 0) return null
  const biggest = items.reduce((best, p) => (p.profit > best.profit ? p : best), items[0])
  const recent = items.slice(0, 10)
  const wins = recent.filter(p => p.profit >= 0).length
  return (
    <div className="sig-stats-row" style={{ marginBottom: 24 }}>
      <div className="sig-stat-cell">
        <div className="sig-stat-cell-label">Biggest Win</div>
        <div className="sig-stat-cell-val g" style={{ fontSize: '0.95rem' }}>{fmtSigned(biggest.profit)}</div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: 2 }}>{biggest.title} — {biggest.outcome}</div>
      </div>
      <div className="sig-stat-cell">
        <div className="sig-stat-cell-label">Recent Form</div>
        <div className="sig-stat-cell-val">{wins}–{recent.length - wins}</div>
        <div style={{ color: 'var(--text-dim)', fontSize: '0.75rem', marginTop: 2 }}>last {recent.length} resolved</div>
      </div>
    </div>
  )
}

// Real-data-only, same reasoning as CumulativeChartSection — the Edge
// Function only ever computes categoryBreakdown for an entitled+tracked
// caller (Polymarket's public API has no category field for the untracked
// path either), so there's no locked/fake variant to build here.
function CategoryBreakdownSection({ categoryBreakdown }: { categoryBreakdown: CategoryRow[] }) {
  if (categoryBreakdown.length === 0) return null
  return (
    <>
      <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Where they win</div>
      <div className="sig-table-wrap" style={{ marginBottom: 24 }}>
        <table className="sig-table">
          <thead><tr><th>Category</th><th className="num">Trades</th><th className="num">Win Rate</th><th className="num">Profit</th></tr></thead>
          <tbody>
            {categoryBreakdown.map(c => (
              <tr key={c.category}>
                <td>{categoryLabel(c.category)}</td>
                <td className="num">{c.n}</td>
                <td className="num">{(c.won + c.lost > 0 ? (c.won / (c.won + c.lost)) * 100 : 0).toFixed(1)}%</td>
                <td className="num" style={{ color: c.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(c.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const walletParam = searchParams.get('wallet') ?? ''
  const [input, setInput] = useState(walletParam)
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(!!walletParam)
  const [error, setError] = useState<string | null>(null)
  const [showAllTrades, setShowAllTrades] = useState(false)
  const [showAllLive, setShowAllLive] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setLoggedIn(!!data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => setLoggedIn(!!session))
    return () => sub.subscription.unsubscribe()
  }, [])

  const runSearch = useCallback((wallet: string) => {
    supabase.functions.invoke('wallet-search', { body: { wallet } })
      .then(({ data, error: fnError }) => {
        if (fnError) throw fnError
        setResult(data as SearchResult)
        setError(null)
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (walletParam) runSearch(walletParam)
  }, [walletParam, runSearch])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed) return
    setLoading(true)
    setShowAllTrades(false)
    setShowAllLive(false)
    setSearchParams({ wallet: trimmed })
  }

  const signupHref = appUrl(`/signup?next=${encodeURIComponent(appUrl(`/search?wallet=${walletParam}`))}`)

  const trackedCumulative = [...(result?.positions ?? [])]
    .sort((a, b) => new Date(a.resolved_ts).getTime() - new Date(b.resolved_ts).getTime())
    .reduce<{ d: string; cum: number }[]>((acc, p) => {
      const prevCum = acc.length > 0 ? acc[acc.length - 1].cum : 0
      acc.push({ d: p.resolved_ts, cum: prevCum + p.profit })
      return acc
    }, [])

  const sortedLiveClosed = [...(result?.liveClosed ?? [])].sort((a, b) => b.timestamp - a.timestamp)
  const liveCumulative = [...sortedLiveClosed].reverse()
    .reduce<{ d: string; cum: number }[]>((acc, p) => {
      const prevCum = acc.length > 0 ? acc[acc.length - 1].cum : 0
      acc.push({ d: new Date(p.timestamp * 1000).toISOString(), cum: prevCum + p.realizedPnl })
      return acc
    }, [])
  const liveWon = sortedLiveClosed.filter(p => p.curPrice >= 0.5).length
  const liveWinRate = sortedLiveClosed.length > 0 ? (liveWon / sortedLiveClosed.length) * 100 : 0
  const liveRealizedPnl = sortedLiveClosed.reduce((s, p) => s + p.realizedPnl, 0)

  return (
    <div className="sig-page" style={{ padding: 0 }}>
      <div className="search-header">
        <a href={marketingUrl('/')} className="search-logo">VisibleTrader</a>
        <div className="search-header-links">
          {loggedIn === false && <a href={appUrl('/login')}>Log in</a>}
          {loggedIn ? <a href={appUrl('/')}>Go to dashboard →</a> : <a href={appUrl('/signup')} className="search-glass-btn" style={{ padding: '0.5rem 1.1rem', fontSize: '0.8125rem' }}>Start free trial</a>}
        </div>
      </div>

      <div className="search-hero">
        <h1>Look up any Polymarket trader</h1>
        <p>See a wallet's real resolved track record and which other top traders are moving with it.</p>
        <form className="search-form" onSubmit={submit}>
          <input
            className="search-input" type="text" placeholder="0x… wallet address"
            value={input} onChange={e => setInput(e.target.value)}
          />
          <button type="submit" className="search-submit" disabled={loading}>
            {loading ? 'Searching…' : 'Search'}
          </button>
        </form>
      </div>

      {error && (
        <div className="search-results"><div className="sig-empty">Could not reach the signals backend — try again in a moment.</div></div>
      )}

      {!error && walletParam && !loading && result && (
        <div className="search-results">
          <div className="search-trader-header">
            <div className="search-trader-name">
              {traderLabel(result.wallet, result.walletName)}
              <a href={profileUrl(result.wallet)!} target="_blank" rel="noopener noreferrer">View on Polymarket ↗</a>
            </div>
            {result.headline?.rank != null && (
              <span className="search-trader-rank">Top-{result.headline.rank.toLocaleString()} by realized P&L</span>
            )}
          </div>

          {/* ── Tracked wallet: our own proprietary analysis ── */}
          {result.tracked && result.headline && (
            <>
              <div className="sig-stats-row" style={{ marginBottom: 24 }}>
                <div className="sig-stat-cell">
                  <div className="sig-stat-cell-label">Net P&L</div>
                  <div className={`sig-stat-cell-val ${result.headline.netProfit >= 0 ? 'g' : 'r'}`}>{fmtSigned(result.headline.netProfit)}</div>
                </div>
                <div className="sig-stat-cell">
                  <div className="sig-stat-cell-label">Win Rate</div>
                  <div className="sig-stat-cell-val">{result.headline.winRate.toFixed(1)}%</div>
                </div>
                <div className="sig-stat-cell">
                  <div className="sig-stat-cell-label">ROI</div>
                  <div className={`sig-stat-cell-val ${result.headline.roi >= 0 ? 'g' : 'r'}`}>{result.headline.roi >= 0 ? '+' : ''}{result.headline.roi.toFixed(1)}%</div>
                </div>
                <div className="sig-stat-cell">
                  <div className="sig-stat-cell-label">Resolved Trades</div>
                  <div className="sig-stat-cell-val">{result.headline.resolvedCount}</div>
                </div>
              </div>

              {result.entitled && result.positions && (
                <>
                  <CumulativeChartSection data={trackedCumulative} label="P&L over time" />
                  <HighlightsRow items={result.positions} />
                  {result.categoryBreakdown && <CategoryBreakdownSection categoryBreakdown={result.categoryBreakdown} />}
                </>
              )}

              <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Trade history</div>
              {result.entitled && result.positions ? (
                <div className="sig-table-wrap" style={{ marginBottom: 24 }}>
                  <table className="sig-table">
                    <thead>
                      <tr><th>Market</th><th className="num">Stake</th><th className="num">Price</th><th>Result</th><th className="num">Profit</th><th className="num">Resolved</th></tr>
                    </thead>
                    <tbody>
                      {(showAllTrades ? result.positions : result.positions.slice(0, 10)).map((p, i) => (
                        <tr key={i}>
                          <td>{p.title} <span style={{ color: 'var(--text-dim)' }}>— {p.outcome}</span></td>
                          <td className="num" data-label="Stake">{fmtFull(p.usd)}</td>
                          <td className="num" data-label="Price">{Math.round(p.price * 100)}¢</td>
                          <td data-label="Result" style={{ color: p.resolved_win ? 'var(--green)' : 'var(--red)' }}>{p.resolved_win ? 'Won' : 'Lost'}</td>
                          <td className="num" data-label="Profit" style={{ color: p.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(p.profit)}</td>
                          <td className="num" data-label="Resolved" style={{ color: 'var(--text-dim)' }}>{timeAgo(p.resolved_ts)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {result.positions.length > 10 && (
                    <button className="sig-load-more" onClick={() => setShowAllTrades(v => !v)}>
                      {showAllTrades ? 'Show fewer' : `Show all ${result.positions.length} trades`}
                    </button>
                  )}
                </div>
              ) : (
                <div className="search-locked">
                  <div className="search-locked-bg">
                    <table className="sig-table">
                      <thead><tr><th>Market</th><th>Result</th><th className="num">Profit</th></tr></thead>
                      <tbody>
                        {fakePositions.map((p, i) => (
                          <tr key={i}>
                            <td>{p.market} <span style={{ color: 'var(--text-dim)' }}>— {p.outcome}</span></td>
                            <td style={{ color: 'var(--green)' }}>Won</td>
                            <td className="num" style={{ color: p.profit.startsWith('-') ? 'var(--red)' : 'var(--green)' }}>{p.profit}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="search-glass-overlay">
                    <p className="search-glass-title">Sign up to see {traderLabel(result.wallet, result.walletName)}'s full trade history</p>
                    <a href={signupHref} className="search-glass-btn">Start 7-day free trial</a>
                  </div>
                </div>
              )}

              <SimilarTradersSection entitled={result.entitled} similarTraders={result.similarTraders} signupHref={signupHref} />
            </>
          )}

          {/* ── Untracked wallet: live public Polymarket data, never gated ── */}
          {!result.tracked && (
            <>
              <div className="sig-empty" style={{ marginBottom: 20 }}>
                Not in our tracked history yet — showing live data straight from Polymarket instead.
              </div>
              {(result.livePositions?.length ?? 0) === 0 && (result.liveClosed?.length ?? 0) === 0 && (
                <div className="sig-empty">Nothing found for this wallet on Polymarket either.</div>
              )}

              {sortedLiveClosed.length > 0 && (
                <>
                  <div className="sig-stats-row" style={{ marginBottom: 24 }}>
                    <div className="sig-stat-cell">
                      <div className="sig-stat-cell-label">Realized P&L</div>
                      <div className={`sig-stat-cell-val ${liveRealizedPnl >= 0 ? 'g' : 'r'}`}>{fmtSigned(liveRealizedPnl)}</div>
                    </div>
                    <div className="sig-stat-cell">
                      <div className="sig-stat-cell-label">Win Rate</div>
                      <div className="sig-stat-cell-val">{liveWinRate.toFixed(1)}%</div>
                    </div>
                    <div className="sig-stat-cell">
                      <div className="sig-stat-cell-label">Current Positions</div>
                      <div className="sig-stat-cell-val">{result.livePositions?.length ?? 0}</div>
                    </div>
                    <div className="sig-stat-cell">
                      <div className="sig-stat-cell-label">Total Positions</div>
                      <div className="sig-stat-cell-val">{sortedLiveClosed.length}</div>
                    </div>
                  </div>

                  <CumulativeChartSection data={liveCumulative} label="Realized P&L over time (live from Polymarket)" />
                  <HighlightsRow items={sortedLiveClosed.map(p => ({ title: p.title, outcome: p.outcome, profit: p.realizedPnl }))} />

                  <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Trade history</div>
                  <div className="sig-table-wrap">
                    <table className="sig-table">
                      <thead><tr><th>Market</th><th>Result</th><th className="num">Profit</th><th className="num">Resolved</th></tr></thead>
                      <tbody>
                        {(showAllLive ? sortedLiveClosed : sortedLiveClosed.slice(0, 10)).map((p, i) => (
                          <tr key={i}>
                            <td>{p.title} <span style={{ color: 'var(--text-dim)' }}>— {p.outcome}</span></td>
                            <td style={{ color: p.curPrice >= 0.5 ? 'var(--green)' : 'var(--red)' }}>{p.curPrice >= 0.5 ? 'Won' : 'Lost'}</td>
                            <td className="num" style={{ color: p.realizedPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtSigned(p.realizedPnl)}</td>
                            <td className="num" style={{ color: 'var(--text-dim)' }}>{timeAgo(new Date(p.timestamp * 1000).toISOString())}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {sortedLiveClosed.length > 10 && (
                      <button className="sig-load-more" onClick={() => setShowAllLive(v => !v)}>
                        {showAllLive ? 'Show fewer' : `Show all ${sortedLiveClosed.length} trades`}
                      </button>
                    )}
                  </div>
                </>
              )}

              <SimilarTradersSection entitled={result.entitled} similarTraders={result.similarTraders} signupHref={signupHref} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
