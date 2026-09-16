-- Tracks the high-water mark (max resolved_ts already folded into
-- wallet_category_breakdown_cache) so refresh_wallet_category_breakdown()
-- can aggregate only newly-resolved positions instead of recomputing the
-- full cache from opportunity_wallets on every run. See
-- scripts/live-signal-service.py's refresh_wallet_category_breakdown for
-- the full story — this was the single biggest consumer of DB compute
-- after the active-roster rollout grew opportunity_wallets much faster.
CREATE TABLE IF NOT EXISTS wallet_category_breakdown_refresh_state (
  id boolean PRIMARY KEY DEFAULT true,
  last_resolved_ts timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton CHECK (id)
);

INSERT INTO wallet_category_breakdown_refresh_state (id, last_resolved_ts)
VALUES (true, now())
ON CONFLICT (id) DO NOTHING;
