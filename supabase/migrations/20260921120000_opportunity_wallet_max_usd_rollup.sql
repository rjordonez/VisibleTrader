-- best_bet_ratio (MAX(usd / usdc_balance) per (condition_id, outcome)) was
-- being recomputed by rescanning every opportunity_wallets row for the
-- pair. Most markets are tiny (median 9 rows), but a handful of heavily-
-- traded markets have 5,000-7,000+ rows — and since the same wallets trade
-- those markets repeatedly, that meant rescanning thousands of duplicate
-- (wallet, market) hits every time. In production this occasionally blew
-- past statement_timeout when a dirty batch happened to include one of
-- these heavy markets, silently losing that batch's update (see
-- refresh_opportunity_aggregates's docstring in scripts/live-signal-service.py).
--
-- This table tracks each wallet's single largest trade per market. It's
-- maintained incrementally (one O(1) upsert per trade in
-- record_contribution, since a wallet's max trade in a market only ever
-- grows and the underlying usd amount is immutable once inserted) instead
-- of by rescanning. Recomputing best_bet_ratio for a pair then means
-- scanning its distinct wallets, not its trades — for the heaviest markets
-- tested, that's the difference between ~7,000 rows and ~500 wallets.
CREATE TABLE IF NOT EXISTS opportunity_wallet_max_usd (
  condition_id text NOT NULL,
  outcome text NOT NULL,
  wallet text NOT NULL,
  max_usd numeric NOT NULL,
  PRIMARY KEY (condition_id, outcome, wallet)
);

-- One-time backfill from existing trade history. Idempotent (GREATEST) —
-- safe to re-run, e.g. to close the gap between this migration running and
-- the incremental-write code path actually being deployed. Production's
-- opportunity_wallets is 3.4M rows (6x the dev-branch snapshot this
-- migration was first tested against) — the default 2min statement_timeout
-- isn't enough for a single-pass full scan at that size, so it's raised
-- for this transaction only.
SET LOCAL statement_timeout = '20min';
INSERT INTO opportunity_wallet_max_usd (condition_id, outcome, wallet, max_usd)
SELECT condition_id, outcome, wallet, MAX(usd)
FROM opportunity_wallets
WHERE wallet IS NOT NULL
GROUP BY condition_id, outcome, wallet
ON CONFLICT (condition_id, outcome, wallet) DO UPDATE SET
  max_usd = GREATEST(opportunity_wallet_max_usd.max_usd, EXCLUDED.max_usd);
