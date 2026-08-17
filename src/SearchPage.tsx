import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from './lib/supabase'
import { traderLabel, profileUrl, fmtSigned, fmtFull, timeAgo } from './app/helpers'
import { appUrl, marketingUrl } from './lib/domains'

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

interface SearchResult {
  tracked: boolean
  wallet: string
  walletName: string | null
  entitled: boolean
  headline: Headline | null
  positions: Position[] | null
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

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const walletParam = searchParams.get('wallet') ?? ''
  const [input, setInput] = useState(walletParam)
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null)
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(!!walletParam)
  const [error, setError] = useState<string | null>(null)

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
    setSearchParams({ wallet: trimmed })
  }

  const signupHref = appUrl(`/signup?next=${encodeURIComponent(appUrl(`/search?wallet=${walletParam}`))}`)

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

              <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Trade history</div>
              {result.entitled && result.positions ? (
                <div className="sig-table-wrap" style={{ marginBottom: 24 }}>
                  <table className="sig-table">
                    <thead>
                      <tr><th>Market</th><th className="num">Stake</th><th className="num">Price</th><th>Result</th><th className="num">Profit</th><th className="num">Resolved</th></tr>
                    </thead>
                    <tbody>
                      {result.positions.map((p, i) => (
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
              {(result.liveClosed?.length ?? 0) > 0 && (
                <div className="sig-table-wrap">
                  <table className="sig-table">
                    <thead><tr><th>Market</th><th>Result</th><th className="num">Profit</th><th className="num">Resolved</th></tr></thead>
                    <tbody>
                      {[...(result.liveClosed ?? [])].sort((a, b) => b.timestamp - a.timestamp).map((p, i) => (
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
              )}

              <SimilarTradersSection entitled={result.entitled} similarTraders={result.similarTraders} signupHref={signupHref} />
            </>
          )}
        </div>
      )}
    </div>
  )
}
