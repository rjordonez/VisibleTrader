import { useEffect, useMemo, useState } from 'react'
import type { Opportunity, WalletContribution, ChartPoint } from './types'
import {
  fetchWallets, fetchChart, categoryIcon, signalsTag, signalsTraderStatus,
  walletReturn, fmtFull, fmtSigned, profileUrl, traderLabel, timeAgo,
} from './helpers'
import { PriceChart } from './PriceChart'
import { SkelBlock, SkelDrillRows } from './Skeleton'

interface TraderGroup {
  wallet: string
  wallet_name: string | null
  entries: WalletContribution[]
}

// A trader with many small buys in the same market (not unusual — someone
// scaling into a position) used to render one full row per buy, which
// buried the list under a dozen+ near-identical rows for a single person.
// Grouped by wallet instead: a single entry renders exactly as before, more
// than one collapses into one summary row (avg entry, total invested,
// total P&L) that expands to the individual buys on click.
function groupByWallet(wallets: WalletContribution[]): TraderGroup[] {
  const map = new Map<string, TraderGroup>()
  for (const w of wallets) {
    const existing = map.get(w.wallet)
    if (existing) existing.entries.push(w)
    else map.set(w.wallet, { wallet: w.wallet, wallet_name: w.wallet_name, entries: [w] })
  }
  // Biggest positions first — a trader's total stake in this market is a
  // more useful sort key here than the order individual buys happened in.
  return Array.from(map.values()).sort(
    (a, b) => b.entries.reduce((s, e) => s + e.usd, 0) - a.entries.reduce((s, e) => s + e.usd, 0)
  )
}

function SingleEntryRow({ w, latestPrice }: { w: WalletContribution; latestPrice: number }) {
  const st = signalsTraderStatus(w)
  const ret = walletReturn(w, latestPrice)
  return (
    <div className="sig-drill-row">
      <a href={profileUrl(w.wallet)!} target="_blank" rel="noopener noreferrer" className="sig-drill-name">
        {traderLabel(w.wallet, w.wallet_name)}
      </a>
      <div className="sig-drill-body">
        <div className="sig-drill-detail">{fmtFull(w.usd)} at {Math.round(w.price * 100)}¢ · {timeAgo(w.ts)}</div>
        <div className="sig-drill-meta">
          <div style={{ fontSize: 11.5, fontWeight: 700, color: ret.profit >= 0 ? '#00d17a' : '#ff3b5c', flexShrink: 0 }}>
            {fmtSigned(ret.profit)}{!ret.realized ? ' (unrealized)' : ''}
          </div>
          <div className="sig-drill-status" style={{ color: st.color, background: st.color + '26' }}>{st.label}</div>
        </div>
      </div>
    </div>
  )
}

function TraderGroupRow({ group, latestPrice }: { group: TraderGroup; latestPrice: number }) {
  const [expanded, setExpanded] = useState(false)
  const { wallet, wallet_name, entries } = group

  if (entries.length === 1) return <SingleEntryRow w={entries[0]} latestPrice={latestPrice} />

  const totalUsd = entries.reduce((s, e) => s + e.usd, 0)
  const avgPrice = entries.reduce((s, e) => s + e.usd * e.price, 0) / totalUsd
  const totalProfit = entries.reduce((s, e) => s + walletReturn(e, latestPrice).profit, 0)
  const allUnrealized = entries.every(e => !walletReturn(e, latestPrice).realized)

  return (
    <div className="sig-trader-group">
      <div className="sig-drill-row sig-trader-group-header" onClick={() => setExpanded(e => !e)}>
        <a
          href={profileUrl(wallet)!} target="_blank" rel="noopener noreferrer" className="sig-drill-name"
          onClick={e => e.stopPropagation()}
        >
          {traderLabel(wallet, wallet_name)}
        </a>
        <div className="sig-drill-body">
          <div className="sig-drill-detail">
            {entries.length} buys · avg {Math.round(avgPrice * 100)}¢ · {fmtFull(totalUsd)} invested
          </div>
          <div className="sig-drill-meta">
            <div style={{ fontSize: 11.5, fontWeight: 700, color: totalProfit >= 0 ? '#00d17a' : '#ff3b5c', flexShrink: 0 }}>
              {fmtSigned(totalProfit)}{allUnrealized ? ' (unrealized)' : ''}
            </div>
          </div>
        </div>
        {/* Separate from the status-pill slot above on purpose — a colored
            pill there would sit in the exact same spot a status pill
            (Holding/Scalped/etc) does on a single-entry row, and people
            were clicking those expecting them to expand too. A plain
            chevron + count reads as "this row expands" without looking
            like a status label. */}
        <div className="sig-trader-group-toggle">
          <span className="sig-trader-group-count">{entries.length}</span>
          <span className={`sig-trader-group-chevron ${expanded ? 'open' : ''}`}>▾</span>
        </div>
      </div>
      {expanded && (
        <div className="sig-trader-txns" onClick={e => e.stopPropagation()}>
          {entries.map((w, i) => {
            const st = signalsTraderStatus(w)
            const ret = walletReturn(w, latestPrice)
            return (
              <div key={i} className="sig-trader-txn-row">
                <span className="sig-trader-txn-detail">{fmtFull(w.usd)} at {Math.round(w.price * 100)}¢ · {timeAgo(w.ts)}</span>
                <span className="sig-trader-txn-meta">
                  <span style={{ fontWeight: 700, color: ret.profit >= 0 ? '#00d17a' : '#ff3b5c' }}>
                    {fmtSigned(ret.profit)}{!ret.realized ? ' (unrealized)' : ''}
                  </span>
                  <span className="sig-drill-status" style={{ color: st.color, background: st.color + '26' }}>{st.label}</span>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function ActivityBarRow({ leftLabel, leftDisplay, leftValue, rightLabel, rightDisplay, rightValue }: {
  leftLabel: string; leftDisplay: string; leftValue: number
  rightLabel: string; rightDisplay: string; rightValue: number
}) {
  const total = leftValue + rightValue || 1
  const leftPct = (leftValue / total) * 100
  return (
    <div className="sig-activity-row">
      <div className="sig-activity-labels">
        <span>{leftDisplay} <span className="sig-activity-sub">{leftLabel}</span></span>
        <span>{rightDisplay} <span className="sig-activity-sub">{rightLabel}</span></span>
      </div>
      <div className="sig-activity-bar">
        <div className="sig-activity-bar-fill buy" style={{ width: `${leftPct}%` }} />
        <div className="sig-activity-bar-fill sell" style={{ width: `${100 - leftPct}%` }} />
      </div>
    </div>
  )
}

// Buys/sells here are each trader's own entry (a "buy") and exit (a "sell")
// on this specific market — computed from the same contributor rows the
// list below already has, not a separate fetch.
function ActivitySummary({ wallets }: { wallets: WalletContribution[] }) {
  const buys = wallets.length
  const buyVolume = wallets.reduce((s, w) => s + w.usd, 0)
  const buyers = new Set(wallets.map(w => w.wallet)).size

  const exits = wallets.filter(w => w.exit_ts)
  const sells = exits.length
  const sellVolume = exits.reduce((s, w) => s + (w.exit_usd ?? 0), 0)
  const sellers = new Set(exits.map(w => w.wallet)).size

  if (buys === 0) return null

  return (
    <div className="sig-activity">
      <ActivityBarRow leftLabel="buys" leftDisplay={String(buys)} leftValue={buys} rightLabel="sells" rightDisplay={String(sells)} rightValue={sells} />
      <ActivityBarRow leftLabel="vol." leftDisplay={fmtFull(buyVolume)} leftValue={buyVolume} rightLabel="vol." rightDisplay={fmtFull(sellVolume)} rightValue={sellVolume} />
      <ActivityBarRow leftLabel="buyers" leftDisplay={String(buyers)} leftValue={buyers} rightLabel="sellers" rightDisplay={String(sellers)} rightValue={sellers} />
    </div>
  )
}

export function SignalModal({ opportunity: o, onClose }: { opportunity: Opportunity; onClose: () => void }) {
  const [wallets, setWallets] = useState<WalletContribution[]>([])
  const [walletsLoading, setWalletsLoading] = useState(true)
  const [chartHistory, setChartHistory] = useState<ChartPoint[]>([])
  const [chartLoading, setChartLoading] = useState(true)

  useEffect(() => {
    fetchWallets(o.condition_id, o.outcome).then(setWallets).finally(() => setWalletsLoading(false))
    fetchChart(o.condition_id, o.outcome).then(setChartHistory).finally(() => setChartLoading(false))
  }, [o.condition_id, o.outcome])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const groups = useMemo(() => groupByWallet(wallets), [wallets])

  const ic = categoryIcon(o.category)
  const tag = signalsTag(o.tier, o.cumulative_usd)

  return (
    <div className="sig-modal-backdrop" onClick={onClose}>
      <div className="sig-modal-wrap" onClick={e => e.stopPropagation()}>
        <button className="sig-modal-close" onClick={onClose} aria-label="Close">✕</button>
        <div className="sig-modal">
        <div className="sig-hero-top">
          <div className="sig-card-icon" style={{ background: ic.bg, width: 44, height: 44, fontSize: 20 }}>{ic.emoji}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="sig-hero-q">{o.title} <span className="sig-out">— {o.outcome}</span></div>
            <div className="sig-card-meta">
              {o.wallet_count} top trader{o.wallet_count > 1 ? 's' : ''} · <span className={`sig-tag ${tag.cls}`} style={{ marginTop: 0 }}>{tag.label}</span>
            </div>
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: o.total_profit >= 0 ? '#00d17a' : '#ff3b5c', flexShrink: 0 }}>
            {fmtSigned(o.total_profit)}
          </div>
        </div>

        <div className="sig-stats-row" style={{ margin: '16px 0' }}>
          <div className="sig-stat-cell">
            <div className="sig-stat-cell-label">Price</div>
            <div className="sig-stat-cell-val">{Math.round(o.latest_price * 100)}¢</div>
          </div>
          <div className="sig-stat-cell">
            <div className="sig-stat-cell-label">Total Deployed</div>
            <div className="sig-stat-cell-val g">{fmtFull(o.cumulative_usd)}</div>
          </div>
          <div className="sig-stat-cell">
            <div className="sig-stat-cell-label">Traders</div>
            <div className="sig-stat-cell-val">{o.wallet_count}</div>
          </div>
          <div className="sig-stat-cell">
            <div className="sig-stat-cell-label">Total Profit</div>
            <div className={`sig-stat-cell-val ${o.total_profit >= 0 ? 'g' : 'r'}`}>{fmtSigned(o.total_profit)}</div>
          </div>
        </div>

        <div className="sig-modal-cols">
          <div className="sig-modal-col-main">
            <div className="sig-drill-label">Price history — dots mark each trader's buy-in</div>
            <div style={{ minHeight: 220, marginBottom: 16 }}>
              {chartLoading && <SkelBlock height={220} />}
              {!chartLoading && chartHistory.length < 2 && (
                <div style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>No price history available for this market.</div>
              )}
              {!chartLoading && chartHistory.length >= 2 && (
                <PriceChart history={chartHistory} wallets={wallets} />
              )}
            </div>

            {!walletsLoading && wallets.length > 0 && (
              <>
                <div className="sig-drill-label">Activity</div>
                <ActivitySummary wallets={wallets} />
              </>
            )}
          </div>

          <div className="sig-modal-col-side">
            <div className="sig-drill-label">Contributing traders</div>
            <div style={{ minHeight: 5 * 36 }}>
              {walletsLoading && <SkelDrillRows count={5} />}
              {!walletsLoading && wallets.length === 0 && (
                <div style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>No contributor detail available.</div>
              )}
              {!walletsLoading && groups.map(g => (
                <TraderGroupRow key={g.wallet} group={g} latestPrice={o.latest_price} />
              ))}
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  )
}
