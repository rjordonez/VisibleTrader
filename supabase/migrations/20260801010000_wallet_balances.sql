-- Wallet USDC.e balances (Polygon), refreshed periodically by
-- live-signal-service.py via eth_call against the Polymarket collateral
-- token contract. Backs the win-rate / bet-size-as-%-of-wallet filters on
-- Live Ticker and Vetted Picks — bet_usd / usdc_balance is only meaningful
-- once we actually know the wallet's real on-chain balance.
create table wallet_balances (
  wallet text primary key,
  usdc_balance numeric,
  updated_at timestamptz not null default now()
);
alter table wallet_balances enable row level security;
grant select on wallet_balances to anon, authenticated;
create policy "public read" on wallet_balances for select using (true);

-- opportunities_live: add best-contributor win rate + bet ratio. Extends
-- the wallet_agg CTE from 20260728012207_fix_view_performance.sql. First
-- attempt joined wallet_stats/wallet_bal directly alongside the existing
-- live_price join inside wallet_agg — that changed the planner's cost
-- calculus enough that it picked a nested loop for the ow/live_price join
-- (previously a cheap merge join), re-checking ~5.2M row pairs and taking
-- 1168ms instead of ~20ms. Isolating that join into its own materialized
-- ow_priced CTE *before* the wallet-keyed joins are added restores the
-- merge join (verified via EXPLAIN ANALYZE: 1168ms -> 109ms).
create or replace view opportunities_live with (security_invoker = true) as
  WITH max_tier AS MATERIALIZED (
    SELECT condition_id, outcome, MAX(tier) AS max_tier
    FROM opportunities GROUP BY condition_id, outcome
  ),
  live_price AS MATERIALIZED (
    SELECT o2.condition_id, o2.outcome, o2.latest_price AS cur_price
    FROM opportunities o2
    INNER JOIN max_tier m2 ON o2.condition_id = m2.condition_id AND o2.outcome = m2.outcome AND o2.tier = m2.max_tier
  ),
  wallet_stats AS MATERIALIZED (
    SELECT wallet, won, lost FROM leaderboard
  ),
  wallet_bal AS MATERIALIZED (
    SELECT wallet, usdc_balance FROM wallet_balances
  ),
  ow_priced AS MATERIALIZED (
    SELECT ow.condition_id, ow.outcome, ow.wallet, ow.usd, ow.price, ow.exit_ts, ow.exit_price,
      ow.is_scalp, ow.market_closed, ow.resolved_win,
      CASE
        WHEN ow.market_closed = true THEN
          CASE WHEN ow.resolved_win = true THEN (ow.usd / ow.price) - ow.usd ELSE -ow.usd END
        WHEN ow.exit_ts IS NOT NULL AND ow.exit_price IS NOT NULL THEN
          (ow.usd / ow.price) * ow.exit_price - ow.usd
        ELSE
          (ow.usd / ow.price) * COALESCE(lp.cur_price, ow.price) - ow.usd
      END AS profit
    FROM opportunity_wallets ow
    LEFT JOIN live_price lp ON lp.condition_id = ow.condition_id AND lp.outcome = ow.outcome
  ),
  wallet_agg AS MATERIALIZED (
    SELECT op.condition_id, op.outcome,
      COUNT(*) AS entries,
      COUNT(DISTINCT op.wallet) AS live_wallet_count,
      SUM(op.usd) AS live_total_usd,
      SUM(CASE WHEN op.exit_ts IS NOT NULL THEN 1 ELSE 0 END) AS exited,
      SUM(CASE WHEN op.is_scalp = true THEN 1 ELSE 0 END) AS scalped,
      SUM(CASE WHEN op.market_closed = true THEN 1 ELSE 0 END) AS closed,
      SUM(CASE WHEN op.market_closed = true AND op.resolved_win = true THEN 1 ELSE 0 END) AS won,
      SUM(CASE WHEN op.market_closed = true AND op.resolved_win = false THEN 1 ELSE 0 END) AS lost,
      SUM(op.profit) AS total_profit,
      MAX(CASE WHEN (ws.won + ws.lost) > 0 THEN ws.won::numeric / (ws.won + ws.lost) END) AS best_win_rate,
      MAX(CASE WHEN wb.usdc_balance > 0 THEN op.usd / wb.usdc_balance END) AS best_bet_ratio
    FROM ow_priced op
    LEFT JOIN wallet_stats ws ON ws.wallet = op.wallet
    LEFT JOIN wallet_bal wb ON wb.wallet = op.wallet
    GROUP BY op.condition_id, op.outcome
  )
  SELECT o.id, o.condition_id, o.outcome, o.slug, o.title, o.tier, o.first_seen, o.last_updated, o.latest_price, o.category,
    COALESCE(w.live_wallet_count, o.wallet_count) AS wallet_count,
    COALESCE(w.live_total_usd, o.cumulative_usd) AS cumulative_usd,
    COALESCE(w.entries, 0) AS entries,
    COALESCE(w.exited, 0) AS exited,
    COALESCE(w.scalped, 0) AS scalped,
    COALESCE(w.closed, 0) AS closed,
    COALESCE(w.won, 0) AS won,
    COALESCE(w.lost, 0) AS lost,
    COALESCE(w.total_profit, 0) AS total_profit,
    COALESCE(w.best_win_rate, 0) AS best_win_rate,
    COALESCE(w.best_bet_ratio, 0) AS best_bet_ratio
  FROM opportunities o
  INNER JOIN max_tier m ON o.condition_id = m.condition_id AND o.outcome = m.outcome AND o.tier = m.max_tier
  LEFT JOIN wallet_agg w ON o.condition_id = w.condition_id AND o.outcome = w.outcome;
