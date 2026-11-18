-- supabase-no-transaction
--
-- Profit-bot incremental refresh was still doing ~460MB of cold random reads
-- on opportunity_wallets (~43s per 120s pass) because the partial indexes it
-- was meant to use (pbot_resolved_idx / pbot_open_idx) lead with `wallet`,
-- so the (condition_id, outcome) dirty-pair lookup in refresh_profit_bot()
-- could not use them and fell back to co_wallet_idx + per-row heap visits.
--
-- These two partial indexes lead with (condition_id, outcome) and carry the
-- columns the resolved aggregation + its 5th-trader-price lateral need, so
-- the dirty-pair lookup becomes an index-only scan (~2.4s per 1500 pairs,
-- measured; ~95% fewer disk reads). See scripts/live-signal-service.py
-- refresh_profit_bot(). Applied directly to production 2026-11-18.
--
-- CONCURRENTLY + IF NOT EXISTS: safe to (re)run, no table lock, no downtime.

-- Resolved picks path: WHERE resolved_ts IS NOT NULL AND closed_profit IS NOT NULL
--   AND price BETWEEN 0.40 AND 0.80 AND usd >= 100, grouped per (condition_id, outcome).
CREATE INDEX CONCURRENTLY IF NOT EXISTS opportunity_wallets_pbot_resolved_co_idx
ON public.opportunity_wallets (condition_id, outcome, wallet, ts, price, resolved_win, resolved_ts)
WHERE resolved_ts IS NOT NULL AND closed_profit IS NOT NULL
  AND price >= 0.40 AND price <= 0.80 AND usd >= 100;

-- Open picks path: WHERE resolved_ts IS NULL AND exit_ts IS NULL
--   AND price BETWEEN 0.40 AND 0.80 AND usd >= 100, grouped per (condition_id, outcome).
CREATE INDEX CONCURRENTLY IF NOT EXISTS opportunity_wallets_pbot_open_co_idx
ON public.opportunity_wallets (condition_id, outcome, wallet)
WHERE resolved_ts IS NULL AND exit_ts IS NULL
  AND price >= 0.40 AND price <= 0.80 AND usd >= 100;
