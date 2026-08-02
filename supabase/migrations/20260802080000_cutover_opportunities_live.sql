-- Step 7 of the Signals read-path scaling plan: cuts opportunities_live
-- over to the incrementally-maintained opportunity_stats table instead of
-- a GROUP BY over all of opportunity_wallets on every query. Validated on
-- both dev and prod: opportunity_stats/opportunity_contributors have been
-- kept in sync with real live writes for a validation period, with 0
-- mismatches against a fresh recompute (see backfill_opportunity_stats.py
-- and the git history for this migration series).
--
-- best_win_rate scans opportunity_contributors (bounded by distinct
-- market x wallet pairs, not every trade — an accepted, deliberate
-- tradeoff, not fully O(1); a true O(1) version needs a denormalized
-- per-wallet leaderboard, deferred). best_bet_ratio uses a LATERAL
-- subquery scoped to this market via the new (condition_id, outcome,
-- wallet) index instead of a blanket scan, since it's a live value that
-- can't be cached (a wallet's balance changes independently of any
-- specific market's events) but a per-market-scoped index lookup is cheap
-- regardless of total table size.
create or replace view opportunities_live with (security_invoker = true) as
  WITH best_win_rate_agg AS MATERIALIZED (
    SELECT oc.condition_id, oc.outcome,
      MAX(CASE WHEN (ls.won + ls.lost) > 0 THEN ls.won::numeric / (ls.won + ls.lost) END) AS best_win_rate
    FROM opportunity_contributors oc
    LEFT JOIN leaderboard ls ON ls.wallet = oc.wallet
    GROUP BY oc.condition_id, oc.outcome
  )
  SELECT o.id, o.condition_id, o.outcome, o.slug, o.title, o.tier, o.first_seen, o.last_updated, o.latest_price, o.category,
    COALESCE(s.wallet_count, o.wallet_count)::bigint AS wallet_count,
    COALESCE(s.cumulative_usd, o.cumulative_usd) AS cumulative_usd,
    COALESCE(s.entries, 0)::bigint AS entries,
    COALESCE(s.exited, 0)::bigint AS exited,
    COALESCE(s.scalped, 0)::bigint AS scalped,
    COALESCE(s.closed, 0)::bigint AS closed,
    COALESCE(s.won, 0)::bigint AS won,
    COALESCE(s.lost, 0)::bigint AS lost,
    COALESCE(s.realized_profit, 0) + COALESCE(o.latest_price, 0) * COALESCE(s.open_shares_sum, 0) - COALESCE(s.open_invested_usd, 0) AS total_profit,
    COALESCE(b.best_win_rate, 0) AS best_win_rate,
    COALESCE(br.best_bet_ratio, 0) AS best_bet_ratio,
    o.event_slug
  FROM opportunities o
  LEFT JOIN opportunity_stats s ON s.condition_id = o.condition_id AND s.outcome = o.outcome
  LEFT JOIN best_win_rate_agg b ON b.condition_id = o.condition_id AND b.outcome = o.outcome
  LEFT JOIN LATERAL (
    SELECT MAX(ow.usd / wb.usdc_balance) AS best_bet_ratio
    FROM opportunity_wallets ow
    JOIN wallet_balances wb ON wb.wallet = ow.wallet AND wb.usdc_balance >= 1
    WHERE ow.condition_id = o.condition_id AND ow.outcome = o.outcome
  ) br ON true
  WHERE o.is_current = true;
