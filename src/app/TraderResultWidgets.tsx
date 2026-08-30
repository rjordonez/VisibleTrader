import { categoryLabel, fmtSigned, fmtAbbrevSigned, traderLabel } from './helpers'
import { CumulativeChart } from './PriceChart'

// Shared by SearchPage.tsx (public, entitlement-gated) and TraderDetailPage.tsx
// (authenticated, always-entitled since ProtectedRoute already requires an
// active subscription) — same "summarize this trader" widgets, kept in one
// place so the two pages can't silently drift apart.

// The single highest-leverage "summarize this trader at a glance" element —
// a trend line reads in one look, where a table of 50 rows doesn't. Guards
// its own length>1 case so callers can render it unconditionally.
export function CumulativeChartSection({ data, label, height = 220 }: { data: { d: string; cum: number }[]; label: string; height?: number }) {
  if (data.length < 2) return null
  return (
    <>
      <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>{label}</div>
      <div style={{ marginBottom: 24 }}>
        <CumulativeChart data={data} height={height} />
      </div>
    </>
  )
}

// Pure derivation from data already in memory — no new fetch. Only ever
// called where real position-level data exists, same as
// CumulativeChartSection above: there's nothing to build a locked/fake
// version against, so callers simply don't render this otherwise.
export function HighlightsRow({ items }: { items: { title: string; outcome: string; profit: number }[] }) {
  if (items.length === 0) return null
  const biggest = items.reduce((best, p) => (p.profit > best.profit ? p : best), items[0])
  const recent = items.slice(0, 10)
  const wins = recent.filter(p => p.profit >= 0).length
  return (
    <div className="sig-card" style={{ cursor: 'default' }}>
      <div className="sig-stat">
        <span className="sig-stat-label">Biggest Win</span>
        <span className="sig-stat-val g">{fmtSigned(biggest.profit)}</span>
      </div>
      <div style={{ color: 'var(--text-faint)', fontSize: '11.5px', marginTop: -4, marginBottom: 9 }}>{biggest.title} — {biggest.outcome}</div>
      <div className="sig-stat">
        <span className="sig-stat-label">Recent Form</span>
        <span className="sig-stat-val">{wins}–{recent.length - wins} (last {recent.length})</span>
      </div>
    </div>
  )
}

export interface CategoryRow { category: string; n: number; won: number; lost: number; profit: number }

export function CategoryBreakdownSection({ categoryBreakdown }: { categoryBreakdown: CategoryRow[] }) {
  if (categoryBreakdown.length === 0) return null
  return (
    <div>
      <div className="sig-stat-cell-label" style={{ marginBottom: 8 }}>Where they win</div>
      <div className="sig-table-wrap">
        <table className="sig-table">
          <thead><tr><th>Category</th><th className="num">Trades</th><th className="num">Win Rate</th><th className="num">Profit</th></tr></thead>
          <tbody>
            {categoryBreakdown.map(c => (
              <tr key={c.category}>
                <td>{categoryLabel(c.category)}</td>
                <td className="num">{c.n}</td>
                <td className="num">{(c.won + c.lost > 0 ? (c.won / (c.won + c.lost)) * 100 : 0).toFixed(1)}%</td>
                <td className="num" style={{ color: c.profit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtAbbrevSigned(c.profit)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export interface SimilarTrader { wallet: string; walletName: string | null; overlap: number; netProfit: number }

export function SimilarTradersTable({ similarTraders, linkFor, trackedWallets, busyWallet, onTrack, onUntrack, loggedIn, signupHref }: {
  similarTraders: SimilarTrader[]
  linkFor: (wallet: string) => string
  trackedWallets: Record<string, boolean>
  busyWallet: string | null
  onTrack: (wallet: string) => void
  onUntrack: (wallet: string) => void
  loggedIn: boolean | null
  signupHref?: string
}) {
  if (similarTraders.length === 0) return <div className="sig-empty">No overlap with other tracked traders yet.</div>
  return (
    <div className="sig-table-wrap">
      <table className="sig-table">
        <thead><tr><th>Trader</th><th className="num">Overlap</th><th className="num">Net P&L</th></tr></thead>
        <tbody>
          {similarTraders.map(t => (
            <tr key={t.wallet}>
              <td>
                <a href={linkFor(t.wallet)}>{traderLabel(t.wallet, t.walletName)}</a>
                {loggedIn && (
                  trackedWallets[t.wallet] ? (
                    <span
                      className="sig-track-icon-btn active" title="Untrack"
                      onClick={() => onUntrack(t.wallet)}
                    >✓</span>
                  ) : (
                    <span
                      className="sig-track-icon-btn" title="Track"
                      onClick={() => busyWallet !== t.wallet && onTrack(t.wallet)}
                    >{busyWallet === t.wallet ? '…' : '+'}</span>
                  )
                )}
                {!loggedIn && signupHref && (
                  <a href={signupHref} className="sig-track-icon-btn" title="Log in to track">+</a>
                )}
              </td>
              <td className="num">{t.overlap}</td>
              <td className="num" style={{ color: t.netProfit >= 0 ? 'var(--green)' : 'var(--red)' }}>{fmtAbbrevSigned(t.netProfit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
