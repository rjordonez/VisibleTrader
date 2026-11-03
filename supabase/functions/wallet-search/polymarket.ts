// Polymarket's public Data API, v2 (Deno copy of src/lib/polymarketData.ts;
// Edge Functions can't import app code). v1 (/positions, /closed-positions,
// /trades) was retired and now answers every call with 410, which left the
// trader profile's Active / closed / recent-trades panels silently empty.
// v2 renames fields to snake_case, pages by cursor, and folds closed
// positions into /v2/positions?status=... — these helpers map rows back to
// the camelCase shape the app already renders, so callers didn't change.
// Spec: https://data-api.polymarket.com/v2/openapi.json
const BASE = 'https://data-api.polymarket.com/v2'

interface V2Position {
  proxy_wallet: string; token_id: string; condition_id: string
  title: string; slug: string; icon: string; event_slug: string; end_date: string
  outcome: string; outcome_index: number; status: string
  current_size: number; total_size: number; avg_price: number; current_price: number
  current_value: number; entry_cost_usdc: number
  realized_pnl: number; unrealized_pnl: number; total_pnl: number; percent_pnl: number
  redeemable: boolean; last_event_at: number
}

interface V2Trade {
  condition_id: string; token_id: string; title: string; slug: string; outcome: string
  side: string; size: number; price: number; timestamp: number; transaction_hash: string
}

export interface PolymarketPosition {
  title: string; slug: string; icon: string; eventSlug: string; endDate: string
  outcome: string; conditionId: string; asset: string
  size: number; totalBought: number; avgPrice: number; curPrice: number
  initialValue: number; currentValue: number; cashPnl: number; percentPnl: number; realizedPnl: number
  redeemable: boolean; timestamp: number
}

export interface PolymarketTrade {
  title: string; slug: string; outcome: string; conditionId: string; asset: string
  side: string; size: number; price: number; timestamp: number; transactionHash: string
}

async function page<T>(path: string, params: Record<string, string | number>): Promise<T[]> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
  const res = await fetch(`${BASE}${path}?${qs}`)
  if (!res.ok) return []
  const body = await res.json() as { data?: T[] | null }
  return body.data ?? []
}

const toPosition = (p: V2Position): PolymarketPosition => ({
  title: p.title, slug: p.slug, icon: p.icon, eventSlug: p.event_slug, endDate: p.end_date,
  outcome: p.outcome, conditionId: p.condition_id, asset: p.token_id,
  size: p.current_size, totalBought: p.total_size, avgPrice: p.avg_price, curPrice: p.current_price,
  initialValue: p.entry_cost_usdc, currentValue: p.current_value, cashPnl: p.unrealized_pnl,
  percentPnl: p.percent_pnl, realizedPnl: p.realized_pnl,
  redeemable: p.redeemable, timestamp: p.last_event_at,
})

// What the wallet holds right now in markets still trading (v1's
// positions?redeemable=false), worth $1+ so leftover dust shares don't
// count. Same filter as the Leaderboard's open-position count.
export const fetchOpenPositions = (user: string, limit = 50) =>
  page<V2Position>('/positions', { user, status: 'OPEN', filter_type: 'CASH', filter_amount: 1, limit, sort_by: 'CURRENT_VALUE' })
    .then(rows => rows.map(toPosition))

// v1's closed-positions covered every finished position. In v2 that's three
// statuses: sold/redeemed (CLOSED), resolved and won but not redeemed yet
// (REDEEMABLE), and resolved and lost (REDEEMABLE_LOST, which losers rarely
// redeem). Newest first.
export async function fetchClosedPositions(user: string, limit = 200) {
  const batches = await Promise.all(['CLOSED', 'REDEEMABLE', 'REDEEMABLE_LOST'].map(status =>
    page<V2Position>('/positions', { user, status, limit, sort_by: 'TIMESTAMP' }).catch(() => [] as V2Position[])))
  return batches.flat()
    .sort((a, b) => b.last_event_at - a.last_event_at)
    .slice(0, limit)
    .map(toClosed)
}

// Closed rows' current_price is a stale mark (0.5 on sold positions), but
// callers read curPrice >= 0.5 as "won", the way v1's settled 0/1 price
// worked. Settle it from the status instead, and report total P&L: an
// unredeemed win's payout sits in unrealized_pnl, not realized_pnl.
function toClosed(p: V2Position): PolymarketPosition {
  const pnl = p.total_pnl
  const won = p.status === 'REDEEMABLE' ? p.current_value > 0 : p.status === 'CLOSED' ? pnl > 0 : false
  return { ...toPosition(p), curPrice: won ? 1 : 0, realizedPnl: pnl }
}

export const fetchTrades = (user: string, limit = 30) =>
  page<V2Trade>('/trades', { user, limit }).then(rows => rows.map((t): PolymarketTrade => ({
    title: t.title, slug: t.slug, outcome: t.outcome, conditionId: t.condition_id, asset: t.token_id,
    side: t.side, size: t.size, price: t.price, timestamp: t.timestamp, transactionHash: t.transaction_hash,
  })))
