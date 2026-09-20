-- sweep_resolved_positions() (scripts/live-signal-service.py) runs:
--   SELECT DISTINCT ow.condition_id, ow.outcome, o.slug
--   FROM opportunity_wallets ow JOIN opportunities o ON ...
--   WHERE ow.exit_ts IS NULL AND (ow.market_closed IS NULL OR ow.market_closed = false)
-- opportunity_wallets had no index covering this filter, so the planner fell
-- back to scanning via opportunity_wallets_condition_outcome_idx and
-- filtering exit_ts/market_closed per row instead of jumping straight to
-- open positions — this was the single largest query by cumulative disk I/O
-- in the project per pg_stat_statements (~3.5 TB across 3,811 calls).
CREATE INDEX CONCURRENTLY IF NOT EXISTS opportunity_wallets_open_positions_idx
  ON opportunity_wallets (condition_id, outcome)
  WHERE exit_ts IS NULL AND (market_closed IS NULL OR market_closed = false);

-- prune_onchain_fills() (scripts/live-signal-service.py) now compares
-- received_at directly against a timestamptz cutoff (previously
-- EXTRACT(EPOCH FROM received_at) < %s, which wrapped the column in a
-- function and wasn't sargable — forced a full table scan on every call).
-- This index lets that comparison use an index scan instead.
CREATE INDEX CONCURRENTLY IF NOT EXISTS onchain_fills_unprocessed_received_at_idx
  ON onchain_fills (received_at)
  WHERE processed = true;
