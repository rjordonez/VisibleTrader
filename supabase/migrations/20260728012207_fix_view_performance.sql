-- opportunities_live and wallet_positions both nested a GROUP BY subquery
-- (the live-price lookup) inside another GROUP BY subquery, joined back to
-- opportunities. Postgres's planner mis-estimated the join cardinality and
-- picked a nested loop that re-ran the whole wallet aggregation once per
-- outer row instead of once total — measured live at ~505 re-executions,
-- 3.95s for a query that should take ~20ms, timing out under Supabase's
-- statement-timeout for the anon/authenticated roles entirely. Forcing the
-- shared subqueries into `MATERIALIZED` CTEs makes Postgres compute each
-- one exactly once — verified via EXPLAIN ANALYZE: 3952ms -> 21ms, same
-- result set, before applying here.

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
  wallet_agg AS MATERIALIZED (
    SELECT ow.condition_id, ow.outcome,
      COUNT(*) AS entries,
      COUNT(DISTINCT ow.wallet) AS live_wallet_count,
      SUM(ow.usd) AS live_total_usd,
      SUM(CASE WHEN ow.exit_ts IS NOT NULL THEN 1 ELSE 0 END) AS exited,
      SUM(CASE WHEN ow.is_scalp = true THEN 1 ELSE 0 END) AS scalped,
      SUM(CASE WHEN ow.market_closed = true THEN 1 ELSE 0 END) AS closed,
      SUM(CASE WHEN ow.market_closed = true AND ow.resolved_win = true THEN 1 ELSE 0 END) AS won,
      SUM(CASE WHEN ow.market_closed = true AND ow.resolved_win = false THEN 1 ELSE 0 END) AS lost,
      SUM(
        CASE
          WHEN ow.market_closed = true THEN
            CASE WHEN ow.resolved_win = true THEN (ow.usd / ow.price) - ow.usd ELSE -ow.usd END
          WHEN ow.exit_ts IS NOT NULL AND ow.exit_price IS NOT NULL THEN
            (ow.usd / ow.price) * ow.exit_price - ow.usd
          ELSE
            (ow.usd / ow.price) * COALESCE(lp.cur_price, ow.price) - ow.usd
        END
      ) AS total_profit
    FROM opportunity_wallets ow
    LEFT JOIN live_price lp ON lp.condition_id = ow.condition_id AND lp.outcome = ow.outcome
    GROUP BY ow.condition_id, ow.outcome
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
    COALESCE(w.total_profit, 0) AS total_profit
  FROM opportunities o
  INNER JOIN max_tier m ON o.condition_id = m.condition_id AND o.outcome = m.outcome AND o.tier = m.max_tier
  LEFT JOIN wallet_agg w ON o.condition_id = w.condition_id AND o.outcome = w.outcome;

create or replace view wallet_positions with (security_invoker = true) as
  WITH max_tier AS MATERIALIZED (
    SELECT condition_id, outcome, MAX(tier) AS max_tier
    FROM opportunities GROUP BY condition_id, outcome
  ),
  live_price AS MATERIALIZED (
    SELECT o2.condition_id, o2.outcome, o2.latest_price AS cur_price
    FROM opportunities o2
    INNER JOIN max_tier m2 ON o2.condition_id = m2.condition_id AND o2.outcome = m2.outcome AND o2.tier = m2.max_tier
  ),
  titles AS MATERIALIZED (
    SELECT condition_id, outcome, MAX(title) AS title, MAX(category) AS category
    FROM opportunities GROUP BY condition_id, outcome
  )
  SELECT ow.condition_id, ow.outcome, ow.wallet, ow.wallet_name, o.title, o.category,
    ow.usd, ow.price, ow.ts, ow.exit_ts, ow.exit_price, ow.exit_usd, ow.hold_seconds,
    ow.is_scalp, ow.market_closed, ow.resolved_win, ow.resolved_ts,
    CASE
      WHEN ow.market_closed = true THEN
        CASE WHEN ow.resolved_win = true THEN (ow.usd / ow.price) - ow.usd ELSE -ow.usd END
      WHEN ow.exit_ts IS NOT NULL AND ow.exit_price IS NOT NULL THEN
        (ow.usd / ow.price) * ow.exit_price - ow.usd
      ELSE
        (ow.usd / ow.price) * COALESCE(lp.cur_price, ow.price) - ow.usd
    END AS profit
  FROM opportunity_wallets ow
  JOIN titles o ON o.condition_id = ow.condition_id AND o.outcome = ow.outcome
  LEFT JOIN live_price lp ON lp.condition_id = ow.condition_id AND lp.outcome = ow.outcome;
