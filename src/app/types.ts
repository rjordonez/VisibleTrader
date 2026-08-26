export interface Opportunity {
  id: number
  condition_id: string
  outcome: string
  slug: string
  event_slug: string | null
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

export interface WalletContribution {
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

// Matches the wallet_positions view (opportunity_wallets joined with
// opportunities for market metadata, plus a computed profit + closed_at) —
// unlike WalletContribution above, this is used as a flat, cross-market
// list (the wins feed), so it needs its own condition_id/outcome/title/
// category rather than inheriting them from a parent Opportunity.
export interface WalletPosition extends WalletContribution {
  condition_id: string
  outcome: string
  title: string
  category: string | null
  profit: number
  closed_at: string
}

export interface TickerTrade {
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

export interface ChartPoint { t: number; p: number }
