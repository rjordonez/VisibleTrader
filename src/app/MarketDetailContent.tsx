import { MarketIcon } from './MarketIcon'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { Opportunity, WalletContribution, ChartPoint } from './types'
import {
  fetchWallets, fetchChart, signalsTag, signalsTraderStatus,
  walletReturn, fmtFull, fmtSigned, traderLabel, timeAgo, avatarGradient,
} from './helpers'
import GogglesMark from './GogglesMark'
import { dashboardPath } from '../lib/domains'
import { supabase } from '../lib/supabase'
import { PriceChart } from './PriceChart'
import { PickChart } from './PickChart'
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

interface TraderRecord { wallet: string; won: number; lost: number }

const TRADERS_PER_PAGE = 10
const TOP_TRADER_COUNT = 3
// Same "has a real record" bar the Discover feed uses, so a 1-for-1 wallet
// can't headline the popup with a 100% win rate.
const MIN_RESOLVED = 10

const winRate = (r: TraderRecord) => r.won / (r.won + r.lost)

// Win/loss records for just this market's contributors, from the same
// leaderboard view the Leaderboard page reads.
function useTraderRecords(wallets: string[]) {
  const [records, setRecords] = useState<Map<string, TraderRecord>>(new Map())
  const key = wallets.join(',')
  useEffect(() => {
    if (!key) return
    let cancelled = false
    Promise.resolve(
      supabase.from('leaderboard').select('wallet,won,lost').in('wallet', key.split(','))
    ).then(({ data }) => {
      if (!cancelled) setRecords(new Map(((data ?? []) as TraderRecord[]).map(r => [r.wallet, r])))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [key])
  return records
}

function TopTraders({ groups, records, linkToTrader, onSeeMore }: {
  groups: TraderGroup[]
  records: Map<string, TraderRecord>
  linkToTrader: (wallet: string) => string
  onSeeMore: () => void
}) {
  const top = groups
    .map(g => ({ g, r: records.get(g.wallet) }))
    .filter((x): x is { g: TraderGroup; r: TraderRecord } => !!x.r && x.r.won + x.r.lost >= MIN_RESOLVED)
    .sort((a, b) => winRate(b.r) - winRate(a.r) || (b.r.won + b.r.lost) - (a.r.won + a.r.lost))
    .slice(0, TOP_TRADER_COUNT)
  if (top.length === 0) return null

  return (
    <section className="mkt-card mkt-top">
      <div className="mkt-card-head">
        <span className="sig-drill-label">Top traders</span>
        <button type="button" className="mkt-see-more" onClick={onSeeMore}>
          See more <ChevronRight size={14} strokeWidth={2.5} />
        </button>
      </div>
      {top.map(({ g, r }, i) => (
        <Link key={g.wallet} to={linkToTrader(g.wallet)} className="mkt-top-row">
          <span className="mkt-top-rank">{i + 1}</span>
          <span className="mkt-top-avatar" style={{ background: avatarGradient(g.wallet) }}><GogglesMark /></span>
          <span className="mkt-top-name">
            <strong>{traderLabel(g.wallet, g.wallet_name)}</strong>
            <small>{r.won.toLocaleString()} won · {r.lost.toLocaleString()} lost</small>
          </span>
          <span className="mkt-top-rate">
            <strong>{Math.round(winRate(r) * 100)}%</strong>
            <small>win rate</small>
          </span>
        </Link>
      ))}
    </section>
  )
}

function SingleEntryRow({ w, latestPrice, linkToTrader, priceUnit }: { w: WalletContribution; latestPrice: number; priceUnit: '¢' | '%'; linkToTrader: (wallet: string) => string }) {
  const st = signalsTraderStatus(w)
  const ret = walletReturn(w, latestPrice)
  return (
    <div className="sig-drill-row">
      <Link to={linkToTrader(w.wallet)} className="sig-drill-name">
        {traderLabel(w.wallet, w.wallet_name)}
      </Link>
      <div className="sig-drill-body">
        <div className="sig-drill-detail">{fmtFull(w.usd)} at {Math.round(w.price * 100)}{priceUnit} · {timeAgo(w.ts)}</div>
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

function TraderGroupRow({ group, latestPrice, linkToTrader, priceUnit }: { group: TraderGroup; latestPrice: number; priceUnit: '¢' | '%'; linkToTrader: (wallet: string) => string }) {
  const [expanded, setExpanded] = useState(false)
  const { wallet, wallet_name, entries } = group

  if (entries.length === 1) return <SingleEntryRow w={entries[0]} latestPrice={latestPrice} linkToTrader={linkToTrader} priceUnit={priceUnit} />

  const totalUsd = entries.reduce((s, e) => s + e.usd, 0)
  const avgPrice = entries.reduce((s, e) => s + e.usd * e.price, 0) / totalUsd
  const totalProfit = entries.reduce((s, e) => s + walletReturn(e, latestPrice).profit, 0)
  const allUnrealized = entries.every(e => !walletReturn(e, latestPrice).realized)

  return (
    <div className="sig-trader-group">
      <div className="sig-drill-row sig-trader-group-header" onClick={() => setExpanded(e => !e)}>
        <Link
          to={linkToTrader(wallet)} className="sig-drill-name"
          onClick={e => e.stopPropagation()}
        >
          {traderLabel(wallet, wallet_name)}
        </Link>
        <div className="sig-drill-body">
          <div className="sig-drill-detail">
            {entries.length} buys · avg {Math.round(avgPrice * 100)}{priceUnit} · {fmtFull(totalUsd)} invested
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
                <span className="sig-trader-txn-detail">{fmtFull(w.usd)} at {Math.round(w.price * 100)}{priceUnit} · {timeAgo(w.ts)}</span>
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

// The shared "everything about one market" content — header, stat row,
// price chart with per-trade markers, buy/sell activity split, and the
// full contributing-traders list. Used both inside SignalModal (a popup)
// and full-width on the Terminal's market route — one implementation, two
// homes, so neither surface can silently drift out of sync with the other.
export function MarketDetailContent({ opportunity: o, linkToTrader = w => dashboardPath(`/trader/${w}`), chartHeight = 220, priceUnit = '¢', chartVariant = 'markers' }: {
  opportunity: Opportunity
  // Overridable so the Terminal keeps trader navigation inside its own
  // route tree instead of bouncing out to the main app — see
  // TraderDetailPage.tsx's identical linkToTrader prop for the same reason.
  linkToTrader?: (wallet: string) => string
  // The Terminal has a full page to work with vs. the modal's fixed
  // 600px-tall popup, so it passes a taller value here.
  priceUnit?: '¢' | '%'
  chartHeight?: number
  // 'markers' = the recharts chart with a per-trade buy-in dot and hover
  // scrub (the modal). 'minimal' = the same PickChart the Signals vetted
  // cards use — a clean reveal-animated line, no dots (the Terminal).
  chartVariant?: 'markers' | 'minimal'
}) {
  const [wallets, setWallets] = useState<WalletContribution[]>([])
  const [walletsLoading, setWalletsLoading] = useState(true)
  const [chartHistory, setChartHistory] = useState<ChartPoint[]>([])
  const [chartLoading, setChartLoading] = useState(true)

  useEffect(() => {
    setWalletsLoading(true)
    setChartLoading(true)
    fetchWallets(o.condition_id, o.outcome).then(setWallets).finally(() => setWalletsLoading(false))
    fetchChart(o.condition_id, o.outcome).then(setChartHistory).finally(() => setChartLoading(false))
  }, [o.condition_id, o.outcome])

  const groups = useMemo(() => groupByWallet(wallets), [wallets])
  const records = useTraderRecords(useMemo(() => groups.map(g => g.wallet), [groups]))
  const tradersRef = useRef<HTMLDivElement>(null)
  // Page is remembered per market so opening a different one starts on page 1.
  const marketKey = `${o.condition_id}::${o.outcome}`
  const [pageState, setPageState] = useState({ marketKey, page: 1 })
  const page = pageState.marketKey === marketKey ? pageState.page : 1
  const setPage = (n: number) => setPageState({ marketKey, page: n })
  const pageCount = Math.max(1, Math.ceil(groups.length / TRADERS_PER_PAGE))
  const safePage = Math.min(page, pageCount)
  const pageGroups = groups.slice((safePage - 1) * TRADERS_PER_PAGE, safePage * TRADERS_PER_PAGE)

  const tag = signalsTag(o.tier, o.cumulative_usd)

  return (
    <div className="mkt-detail">
      <div className="sig-hero-top">
        <MarketIcon conditionId={o.condition_id} outcome={o.outcome} category={o.category} className="sig-card-icon" style={{ width: 44, height: 44, fontSize: 20 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sig-hero-q">{o.title} <span className="sig-out">— {o.outcome}</span></div>
          <div className="sig-card-meta">
            {o.wallet_count} top trader{o.wallet_count > 1 ? 's' : ''} · <span className={`sig-tag ${tag.cls}`} style={{ marginTop: 0 }}>{tag.label}</span>
          </div>
        </div>
      </div>

      <div className="sig-stats-row mkt-stats">
        <div className="sig-stat-cell">
          <div className="sig-stat-cell-label">Price</div>
          <div className="sig-stat-cell-val">{Math.round(o.latest_price * 100)}{priceUnit}</div>
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

      {!walletsLoading && (
        <TopTraders
          groups={groups} records={records} linkToTrader={linkToTrader}
          onSeeMore={() => tradersRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
        />
      )}

      <div className="sig-drill-label">{chartVariant === 'minimal' ? 'Price history' : "Price history — dots mark each trader's buy-in"}</div>
      {chartVariant === 'minimal' ? (
        <div style={{ marginBottom: 16 }}>
          <PickChart
            history={chartLoading ? null : [...chartHistory].filter(p => Number.isFinite(p.t) && Number.isFinite(p.p)).sort((a, b) => a.t - b.t)}
            outcome={o.outcome}
            price={o.latest_price}
            height={chartHeight}
            error={false}
            onRetry={() => {
              setChartLoading(true)
              fetchChart(o.condition_id, o.outcome).then(setChartHistory).finally(() => setChartLoading(false))
            }}
          />
          <div className="expert-pick-chart-caption"><span>Polymarket</span><span>All time</span></div>
        </div>
      ) : (
        <div style={{ minHeight: chartHeight, marginBottom: 16 }}>
          {chartLoading && <SkelBlock height={chartHeight} />}
          {!chartLoading && chartHistory.length < 2 && (
            <div style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>No price history available for this market.</div>
          )}
          {!chartLoading && chartHistory.length >= 2 && (
            <PriceChart history={chartHistory} wallets={wallets} height={chartHeight} />
          )}
        </div>
      )}

      {!walletsLoading && wallets.length > 0 && (
        <>
          <div className="sig-drill-label">Activity</div>
          <ActivitySummary wallets={wallets} />
        </>
      )}

      {/* Holders table sits full-width below the chart/activity, not beside
          them in a narrow side column — matches the fomo reference this was
          modeled on. Its own card (.sig-drill-card), not flush like the
          chart/activity above it. */}
      <div className="sig-drill-card" ref={tradersRef}>
        <div className="sig-drill-label">Contributing traders</div>
        <div style={{ minHeight: 5 * 36 }}>
          {walletsLoading && <SkelDrillRows count={5} />}
          {!walletsLoading && wallets.length === 0 && (
            <div style={{ color: 'var(--text-dim)', fontSize: 12.5 }}>No contributor detail available.</div>
          )}
          {!walletsLoading && pageGroups.map(g => (
            <TraderGroupRow key={g.wallet} group={g} latestPrice={o.latest_price} linkToTrader={linkToTrader} priceUnit={priceUnit} />
          ))}
        </div>
        {!walletsLoading && pageCount > 1 && (
          <div className="sig-pager">
            <button type="button" className="sig-load-more" disabled={safePage === 1} onClick={() => setPage(safePage - 1)}>Prev</button>
            <span className="sig-pager-status">
              Page {safePage} of {pageCount}
              <span> &middot; {groups.length} traders</span>
            </span>
            <button type="button" className="sig-load-more" disabled={safePage === pageCount} onClick={() => setPage(safePage + 1)}>Next</button>
          </div>
        )}
      </div>
    </div>
  )
}
