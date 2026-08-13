-- wallet_positions was never carried over to the is_current-based pattern
-- opportunities_live already moved to in 20260802080000_cutover_opportunities_live.sql
-- (view still tagged with the 20260728 doc comment about MATERIALIZED CTEs
-- fixing a different, older bug). It computed title/category and the
-- current live price via three MATERIALIZED CTEs (max_tier, live_price,
-- titles) that each GROUP BY over the *entire* opportunities table --
-- unconditionally, on every call, regardless of how narrow the caller's
-- filter is, since Postgres can't push predicates into a MATERIALIZED CTE.
-- Measured cost on the Profits page's own query (market_closed = true
-- order by resolved_ts limit 200): ~12,785 -- the single most expensive
-- read in the app, and the one that's been intermittently hitting
-- PostgREST's 8s statement_timeout (57014 -> 500) under load.
--
-- opportunities already carries an is_current flag (one row per
-- condition_id/outcome, index-backed via opportunities_is_current_idx)
-- specifically so callers don't need to recompute "which row is the
-- current one" via MAX(tier)/GROUP BY. Joining straight to that row gets
-- title, category, AND latest_price in one indexed join, replacing all
-- three CTEs -- and because it's a plain join instead of a materialized
-- wall, the planner can now push condition_id/outcome/market_closed/wallet
-- filters down through it like any other join. Verified via EXPLAIN: the
-- three unconditional opportunities scans are gone entirely.
create or replace view wallet_positions with (security_invoker = true) as
  SELECT ow.condition_id, ow.outcome, ow.wallet, ow.wallet_name, o.title, o.category,
    ow.usd, ow.price, ow.ts, ow.exit_ts, ow.exit_price, ow.exit_usd, ow.hold_seconds,
    ow.is_scalp, ow.market_closed, ow.resolved_win, ow.resolved_ts,
    CASE
      WHEN ow.market_closed = true THEN
        CASE WHEN ow.resolved_win = true THEN (ow.usd / ow.price) - ow.usd ELSE -ow.usd END
      WHEN ow.exit_ts IS NOT NULL AND ow.exit_price IS NOT NULL THEN
        (ow.usd / ow.price) * ow.exit_price - ow.usd
      ELSE
        (ow.usd / ow.price) * COALESCE(o.latest_price, ow.price) - ow.usd
    END AS profit
  FROM opportunity_wallets ow
  JOIN opportunities o ON o.condition_id = ow.condition_id AND o.outcome = ow.outcome AND o.is_current = true;

-- The Profits page's own query (market_closed = true order by resolved_ts
-- limit 200) still needed a full scan + sort of every closed position to
-- find the top 200 without this -- an index already sorted by resolved_ts
-- within just the closed subset lets Postgres walk it in order and stop
-- at 200 instead. Verified via EXPLAIN: limit cost ~12,785 -> ~120 combined
-- with the view change above.
create index opportunity_wallets_closed_resolved_idx on opportunity_wallets (resolved_ts desc) where market_closed = true;
