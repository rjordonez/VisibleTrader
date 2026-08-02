-- Step 1 of the Signals read-path scaling plan: indexes only, zero behavior
-- change. opportunities.last_updated is written only by record_tier_crossed
-- (a low-churn, bounded-frequency event), so it's a good keyset-pagination
-- cursor once paired with a tiebreaker for exact-timestamp collisions.
-- The opportunity_wallets composite index keeps per-market/per-wallet
-- lookups fast regardless of total table size, independent of the retention
-- question (deferred — see plan).
create index if not exists opportunities_live_updated_id_idx
  on opportunities (last_updated desc, id desc);

create index if not exists opportunity_wallets_co_wallet_idx
  on opportunity_wallets (condition_id, outcome, wallet);
