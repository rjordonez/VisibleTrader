-- best_bet_ratio was computed via a LEFT JOIN LATERAL, re-executed once per
-- output row (every row in opportunities_live -- 25k+ in prod) instead of
-- once as a set-based aggregate, unlike the near-identical best_win_rate_agg
-- CTE right above it in this same view. Each LATERAL execution joined
-- opportunity_wallets to wallet_balances scoped to a single condition_id/
-- outcome, which the planner satisfied with nested index probes -- cheap
-- per call, but 25k+ calls compounded into ~1.27M buffer hits and 2-3s+ of
-- the view's ~3.7s total execution time (12.8s cold), confirmed via
-- EXPLAIN ANALYZE against a real subscriber's RLS context. Replacing it
-- with a materialized CTE grouped by (condition_id, outcome) -- exactly
-- best_win_rate_agg's existing pattern -- turns that into a single hash
-- join + group by over opportunity_wallets/wallet_balances. Verified via
-- EXPLAIN ANALYZE: same query, same RLS context, 3757ms -> 575ms, with the
-- 25k-loop nested pattern gone entirely from the plan.
create or replace view opportunities_live with (security_invoker = true) as
with best_win_rate_agg as materialized (
  select oc.condition_id, oc.outcome,
    max(case when (ls.won + ls.lost) > 0 then ls.won::numeric / (ls.won + ls.lost)::numeric else null end) as best_win_rate
  from opportunity_contributors oc
  left join leaderboard ls on ls.wallet = oc.wallet
  group by oc.condition_id, oc.outcome
),
best_bet_ratio_agg as materialized (
  select ow.condition_id, ow.outcome, max(ow.usd / wb.usdc_balance) as best_bet_ratio
  from opportunity_wallets ow
  join wallet_balances wb on wb.wallet = ow.wallet and wb.usdc_balance >= 1
  group by ow.condition_id, ow.outcome
)
select o.id, o.condition_id, o.outcome, o.slug, o.title, o.tier, o.first_seen, o.last_updated, o.latest_price, o.category,
  coalesce(s.wallet_count, o.wallet_count)::bigint as wallet_count,
  coalesce(s.cumulative_usd, o.cumulative_usd) as cumulative_usd,
  coalesce(s.entries, 0)::bigint as entries,
  coalesce(s.exited, 0)::bigint as exited,
  coalesce(s.scalped, 0)::bigint as scalped,
  coalesce(s.closed, 0)::bigint as closed,
  coalesce(s.won, 0)::bigint as won,
  coalesce(s.lost, 0)::bigint as lost,
  coalesce(s.realized_profit, 0::numeric) + coalesce(o.latest_price, 0::numeric) * coalesce(s.open_shares_sum, 0::numeric) - coalesce(s.open_invested_usd, 0::numeric) as total_profit,
  coalesce(b.best_win_rate, 0::numeric) as best_win_rate,
  coalesce(br.best_bet_ratio, 0::numeric) as best_bet_ratio,
  o.event_slug
from opportunities o
left join opportunity_stats s on s.condition_id = o.condition_id and s.outcome = o.outcome
left join best_win_rate_agg b on b.condition_id = o.condition_id and b.outcome = o.outcome
left join best_bet_ratio_agg br on br.condition_id = o.condition_id and br.outcome = o.outcome
where o.is_current = true;
