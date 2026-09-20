-- Tracks which (condition_id, outcome) pairs need best_win_rate/
-- best_bet_ratio recomputed. Unlike leaderboard_cache (SUM/COUNT, additive
-- deltas work), these are MAX(...) aggregates over opportunity_wallets /
-- opportunity_contributors joined against wallet_balances and leaderboard —
-- a MAX can only be pushed up by a delta, never down, so a group's true max
-- has to be recomputed from scratch when something in that group changes.
-- The fix is to bound *which* groups get recomputed (via this dirty table)
-- instead of recomputing the full GROUP BY over every (condition_id,
-- outcome) pair on every run. Rows are populated by whatever can move
-- either aggregate (record_contribution, refresh_wallet_balances,
-- refresh_leaderboard's incremental pass) and consumed (DELETE ...
-- RETURNING) by refresh_opportunity_aggregates. See
-- scripts/live-signal-service.py's refresh_opportunity_aggregates for the
-- full story — this was the second-largest disk I/O consumer in the
-- project after leaderboard_cache's old full-recompute, per
-- pg_stat_statements.
CREATE TABLE IF NOT EXISTS opportunity_aggregate_dirty (
  condition_id text NOT NULL,
  outcome text NOT NULL,
  PRIMARY KEY (condition_id, outcome)
);

-- refresh_wallet_balances and refresh_leaderboard both need "which
-- (condition_id, outcome) pairs does this wallet contribute to" to mark the
-- right groups dirty when a wallet's balance or win/loss record changes.
-- opportunity_contributors' only existing index is (condition_id, outcome)
-- and its PK leads with the same two columns, so a wallet-first lookup
-- would otherwise be a full scan.
CREATE INDEX IF NOT EXISTS opportunity_contributors_wallet_idx
  ON opportunity_contributors (wallet);
