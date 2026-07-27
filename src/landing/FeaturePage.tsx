import { useParams, Link } from 'react-router-dom'

const LockIcon = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" className="profit-lock-svg">
    <rect x="5" y="11" width="14" height="10" rx="2" stroke="white" strokeWidth="1.5"/>
    <path d="M8 11V7a4 4 0 0 1 8 0v4" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
  </svg>
)

function LockedPanel({ children, title }: { children: React.ReactNode; title: string }) {
  return (
    <div className="fp-locked-panel">
      <div className="fp-bg-content">
        {children}
      </div>
      <div className="profit-glass-overlay">
        <LockIcon />
        <p className="profit-glass-title">{title}</p>
        <Link to="/pricing" className="profit-glass-btn">Start free trial</Link>
      </div>
    </div>
  )
}

const TickerRows = [
  { market: 'Arizona Diamondbacks vs. Nationals', wallets: 9, price: '53¢', total: '$91,947' },
  { market: 'Will CF América win on 2026-07-24?', wallets: 6, price: '71¢', total: '$21,160' },
  { market: 'Atlanta Braves vs. Baltimore Orioles', wallets: 9, price: '33¢', total: '$26,442' },
  { market: 'US x Iran Effective Ceasefire by July 24?', wallets: 5, price: '15¢', total: '$2,179' },
  { market: 'LoL: LOUD vs paiN Gaming (BO3)', wallets: 2, price: '72¢', total: '$23,346' },
  { market: 'Cincinnati Reds vs. St. Louis Cardinals: O/U 7.5', wallets: 2, price: '58¢', total: '$29,073' },
]

const VettedRows = [
  { market: '9 top traders — Diamondbacks', total: '$91.9k', profit: '+$80,533' },
  { market: '6 top traders — CF América', total: '$21.2k', profit: '+$42,516' },
  { market: '9 top traders — Braves', total: '$26.4k', profit: '+$42,460' },
  { market: '2 top traders — Reds/Cardinals U7.5', total: '$29.1k', profit: '+$21,154' },
  { market: '5 top traders — US x Iran', total: '$2.2k', profit: '+$331' },
  { market: '2 top traders — LoL: LOUD', total: '$23.3k', profit: '+$13,931' },
]

const AlertRows = [
  { title: '🔥 Watched wallet crossed $20k tier', body: 'Arizona Diamondbacks vs. Nationals', time: 'just now' },
  { title: 'New solo pick', body: 'US x Iran ceasefire, 15¢', time: '3m' },
  { title: 'Watched wallet exited', body: 'Held 4.2h, scalp classified', time: '8m' },
  { title: '🔥 9 traders converged', body: 'Atlanta Braves vs. Baltimore Orioles', time: '14m' },
  { title: 'New solo pick', body: 'Bitcoin above $67,500, 93¢', time: '21m' },
  { title: 'Market resolved', body: 'Won — position settled', time: '35m' },
]

const LeaderboardRows = [
  { name: '0xc2e7…be51', trades: 6,  winPct: '100%', winUsd: '100%', profit: '+$227,889' },
  { name: '0x5268…0135', trades: 14, winPct: '79%',  winUsd: '71%',  profit: '+$18,204' },
  { name: '0xfe78…d319', trades: 9,  winPct: '67%',  winUsd: '58%',  profit: '+$9,412' },
  { name: '0x9a11…7c02', trades: 5,  winPct: '80%',  winUsd: '74%',  profit: '+$6,118' },
]

const features: Record<string, {
  label: string
  labelClass: string
  title: string
  sub: string
  bullets: string[]
  lockedTitle: string
  panel: React.ReactNode
}> = {
  'live-ticker': {
    label: 'LIVE TICKER',
    labelClass: 'bento-label-blue',
    title: 'Watch the tape, live',
    sub: 'Every qualifying trade on Polymarket, streamed the moment it happens — sub-second, straight off the order book.',
    bullets: [
      'Real-time trade feed via direct market WebSocket',
      'Filter by category, size, or wallet',
      'Every trade traces back to a real on-chain transaction',
      'No polling delay — sub-second from tick to card',
    ],
    lockedTitle: 'Sign up to watch the live ticker',
    panel: (
      <>
        <div className="fp-bg-header">Live Ticker</div>
        <div className="fp-bg-table-header">
          <span style={{ flex: 2 }}>Market</span><span>Traders</span><span>Price</span><span>Total</span>
        </div>
        {TickerRows.map((r, i) => (
          <div key={i} className="profit-bg-row fp-bg-row-border">
            <span className="profit-bg-label" style={{ flex: 2 }}>{r.market}</span>
            <span className="profit-bg-value" style={{ minWidth: 60, fontSize: '0.75rem' }}>{r.wallets}</span>
            <span className="profit-bg-value" style={{ minWidth: 36 }}>{r.price}</span>
            <span className="profit-bg-value" style={{ color: '#38bdf8', minWidth: 60 }}>{r.total}</span>
          </div>
        ))}
      </>
    ),
  },
  'vetted-picks': {
    label: 'VETTED PICKS',
    labelClass: 'bento-label-green',
    title: 'Capital-weighted conviction',
    sub: 'When multiple top-performing wallets independently pile into the same side of the same market, that convergence gets surfaced and ranked.',
    bullets: [
      'Ranked by real dollars deployed, not just trade count',
      'Price history chart with every buy-in marked',
      'Per-trader realized and unrealized $ return',
      'Sort by most recent or most profitable',
    ],
    lockedTitle: 'Sign up to see live vetted picks',
    panel: (
      <>
        <div className="fp-bg-header">Vetted Picks</div>
        <div className="fp-bg-table-header">
          <span>Market</span><span>Total $</span><span>Profit</span>
        </div>
        {VettedRows.map((r, i) => (
          <div key={i} className="profit-bg-row fp-bg-row-border">
            <span className="profit-bg-label" style={{ flex: 2 }}>{r.market}</span>
            <span className="profit-bg-value" style={{ minWidth: 52 }}>{r.total}</span>
            <span className="profit-bg-value green" style={{ minWidth: 72 }}>{r.profit}</span>
          </div>
        ))}
      </>
    ),
  },
  alerts: {
    label: 'ALERTS',
    labelClass: 'bento-label-blue',
    title: 'Never miss a move',
    sub: 'Build a watchlist of wallets and conviction tiers. Get a browser notification the instant something on your list fires — while the tab is open.',
    bullets: [
      'Watch specific wallets or a minimum conviction tier',
      'Browser notifications, no app install required',
      'Persisted watchlist, saved locally',
      'Full in-page alert history',
    ],
    lockedTitle: 'Sign up to enable alerts',
    panel: (
      <>
        <div className="fp-bg-header">Recent Alerts</div>
        {AlertRows.map((n, i) => (
          <div key={i} className="fp-bg-alert-row">
            <div className="alert-app-icon" style={{ flexShrink: 0 }}>V</div>
            <div className="alert-body" style={{ flex: 1 }}>
              <div className="alert-title-row">{n.title}</div>
              <div className="alert-text">{n.body}</div>
            </div>
            <div className="alert-time">{n.time}</div>
          </div>
        ))}
      </>
    ),
  },
  leaderboard: {
    label: 'LEADERBOARD',
    labelClass: 'bento-label-teal',
    title: 'Real, verified track records',
    sub: "Win rate by trade count, and win rate weighted by dollars deployed — not a platform's claimed all-time PnL, and not cherry-picked.",
    bullets: [
      'Win rate (#) and win rate ($) side by side',
      'Payout-adjusted net profit, not just win/loss count',
      'Per-trader detail page with full resolved history',
      'Ranked by real observed performance since tracked',
    ],
    lockedTitle: 'Sign up to see the full leaderboard',
    panel: (
      <>
        <div className="fp-bg-header">Leaderboard</div>
        <div className="fp-bg-table-header">
          <span style={{ flex: 2 }}>Wallet</span><span>Win % ($)</span><span>Profit</span>
        </div>
        {LeaderboardRows.map((r, i) => (
          <div key={i} className="profit-bg-row fp-bg-row-border">
            <span className="profit-bg-label" style={{ flex: 2 }}>{r.name}</span>
            <span className="profit-bg-value" style={{ minWidth: 52 }}>{r.winUsd}</span>
            <span className="profit-bg-value green" style={{ minWidth: 80 }}>{r.profit}</span>
          </div>
        ))}
      </>
    ),
  },
  profits: {
    label: 'PROFITS',
    labelClass: 'bento-label-orange',
    title: 'Payout-adjusted P&L',
    sub: 'Real resolved profit and loss across every tracked position — accounts for actual payout ratio, not just a win/loss count. Open positions are marked to market against the live price.',
    bullets: [
      'Net P&L, win rate, and ROI on resolved positions',
      'Daily cumulative P&L chart',
      'Unrealized profit on every still-open position',
      'Full position-level detail table',
    ],
    lockedTitle: 'Sign up to see real resolved P&L',
    panel: (
      <>
        <div className="fp-bg-header">Profits Overview</div>
        <div className="profit-bg-row">
          <span className="profit-bg-label">Net P&L (resolved)</span>
          <span className="profit-bg-value green">payout-adjusted</span>
        </div>
        <div className="profit-bg-row">
          <span className="profit-bg-label">Win rate ($)</span>
          <span className="profit-bg-value">weighted by size</span>
        </div>
        <div className="profit-bg-divider" />
        <div className="profit-bg-row">
          <span className="profit-bg-label">Open positions</span>
          <span className="profit-bg-value">marked to market</span>
        </div>
        <div className="profit-bg-row">
          <span className="profit-bg-label">Price source</span>
          <span className="profit-bg-value">live, tick-by-tick</span>
        </div>
        <div className="profit-bg-divider" />
        <div className="profit-bg-bar-group">
          {[32, 48, 24, 60, 40, 52, 36, 70, 44, 80, 56, 90].map((h, i) => (
            <div key={i} className="profit-bg-bar" style={{
              height: h,
              background: i % 2 === 0 ? 'rgba(99,102,241,0.6)' : 'rgba(16,185,129,0.6)'
            }} />
          ))}
        </div>
      </>
    ),
  },
  settings: {
    label: 'CONFIGURABLE',
    labelClass: 'bento-label-gray',
    title: 'Tune it to your risk appetite',
    sub: 'Set how many wallets get tracked, where conviction tiers sit, and what counts as a scalp — changes apply live, no restart needed.',
    bullets: [
      'Roster size — how many top wallets get tracked',
      'Conviction tiers — the $ thresholds that define a signal',
      'Ticker minimum — the size floor for the live feed',
      'Scalp window — how fast a round-trip counts as a scalp',
    ],
    lockedTitle: 'Sign up to configure your roster',
    panel: (
      <>
        <div className="fp-bg-header">Settings</div>
        {[
          { label: 'Roster size', value: '500 wallets' },
          { label: 'Conviction tiers', value: '$1k / $5k / $20k / $50k / $100k' },
          { label: 'Ticker minimum', value: '$100' },
          { label: 'Scalp window', value: '30 minutes' },
        ].map((s, i) => (
          <div key={i} className="profit-bg-row fp-bg-row-border">
            <span className="profit-bg-label" style={{ flex: 1 }}>{s.label}</span>
            <span className="profit-bg-value">{s.value}</span>
          </div>
        ))}
        <div className="profit-bg-divider" />
        <div className="profit-bg-row">
          <span className="profit-bg-label">Applies live</span>
          <span className="profit-bg-value green large">No restart</span>
        </div>
      </>
    ),
  },
}

export default function FeaturePage() {
  const { id } = useParams<{ id: string }>()
  const f = features[id ?? '']

  if (!f) {
    return (
      <section className="fp-wrap">
        <div className="fp-inner">
          <h2>Feature not found</h2>
          <Link to="/" className="fp-back">← Back to home</Link>
        </div>
      </section>
    )
  }

  return (
    <section className="fp-wrap">
      <div className="fp-inner">
        <div className="fp-left">
          <span className={`fp-label ${f.labelClass}`}>{f.label}</span>
          <h1 className="fp-title">{f.title}</h1>
          <p className="fp-sub">{f.sub}</p>
          <ul className="fp-bullets">
            {f.bullets.map(b => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          <div className="fp-actions">
            <Link to="/pricing" className="btn-primary btn-large">View pricing</Link>
          </div>
        </div>

        <div className="fp-right">
          <LockedPanel title={f.lockedTitle}>
            {f.panel}
          </LockedPanel>
        </div>
      </div>
    </section>
  )
}
