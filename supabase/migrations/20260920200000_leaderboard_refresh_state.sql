-- Tracks the high-water mark (max resolved_ts already folded into
-- leaderboard_cache) so refresh_leaderboard() can aggregate only
-- newly-resolved positions instead of recomputing the full cache from
-- opportunity_wallets on every run. Mirrors
-- wallet_category_breakdown_refresh_state / refresh_wallet_category_breakdown
-- (see 20260915073015_wallet_category_breakdown_incremental_state.sql) —
-- refresh_leaderboard was the single largest disk I/O consumer per
-- pg_stat_statements (full GROUP BY over opportunity_wallets every 120s).
CREATE TABLE IF NOT EXISTS leaderboard_refresh_state (
  id boolean PRIMARY KEY DEFAULT true,
  last_resolved_ts timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id)
);

INSERT INTO leaderboard_refresh_state (id, last_resolved_ts)
VALUES (true, now())
ON CONFLICT (id) DO NOTHING;
