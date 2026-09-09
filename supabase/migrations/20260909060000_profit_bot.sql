-- Profit Bot — a rules-based strategy over the tracked-trader data, surfaced
-- on the Profits page. The rules (from a backtest of all 1.37M resolved
-- positions):
--   1. only "proven" wallets: >= 20 resolved, net-positive, win rate >= 52%
--   2. only when >= 3 of those wallets are on the same side of a market
--   3. entry price 40-80c (skips longshots and ~1.00 scalps)
--   4. the wallet staked >= $100 (conviction)
-- Backtest of that filter: ~+40% return on deployed capital, ~75% win rate.

create or replace view proven_wallets as
  select wallet
  from leaderboard
  where (won + lost) >= 20
    and net_profit > 0
    and (won::numeric / nullif(won + lost, 0)) >= 0.52;

comment on view proven_wallets is
  'Wallets that clear the Profit Bot quality bar (>=20 resolved, net-positive, >=52% win rate).';

-- Live picks: open markets where the rules are currently satisfied.
create or replace function profit_bot_picks()
returns table (
  condition_id text,
  outcome text,
  title text,
  slug text,
  event_slug text,
  category text,
  experts int,
  avg_entry numeric,
  latest_price numeric,
  combined_stake numeric,
  last_entry timestamptz
)
language sql
stable
as $$
  with agg as (
    select
      ow.condition_id,
      ow.outcome,
      count(distinct ow.wallet) as experts,
      round(avg(ow.price), 4) as avg_entry,
      round(sum(ow.usd)) as combined_stake,
      max(ow.ts) as last_entry
    from opportunity_wallets ow
    join proven_wallets pw on pw.wallet = ow.wallet
    where ow.resolved_ts is null
      and ow.exit_ts is null
      and ow.price between 0.40 and 0.80
      and ow.usd >= 100
    group by ow.condition_id, ow.outcome
    having count(distinct ow.wallet) >= 3
  )
  select
    a.condition_id, a.outcome, o.title, o.slug, o.event_slug, o.category,
    a.experts::int, a.avg_entry, o.latest_price, a.combined_stake, a.last_entry
  from agg a
  join opportunities o
    on o.condition_id = a.condition_id and o.outcome = a.outcome
  where o.is_current = true
    and o.latest_price between 0.08 and 0.94   -- still a live, tradeable price
  order by a.last_entry desc, a.experts desc
  limit 40;
$$;

comment on function profit_bot_picks is 'Markets currently satisfying the Profit Bot rules, freshest first.';

-- Trailing performance of the same rules over the last 30 days, one row per
-- resolved market (not per wallet), sized as a flat $100 per pick.
create or replace function profit_bot_performance()
returns table (
  picks bigint,
  win_rate numeric,
  avg_return_pct numeric,
  avg_entry numeric,
  flat100_pnl numeric,
  since date
)
language sql
stable
as $$
  with base as (
    select ow.condition_id, ow.outcome, ow.wallet, ow.price, ow.resolved_win
    from opportunity_wallets ow
    join proven_wallets pw on pw.wallet = ow.wallet
    where ow.resolved_ts >= now() - interval '30 days'
      and ow.price between 0.40 and 0.80
      and ow.usd >= 100
      and ow.closed_profit is not null
  ),
  mkt as (
    select condition_id, outcome, bool_or(resolved_win) as won, avg(price) as entry
    from base
    group by condition_id, outcome
    having count(distinct wallet) >= 3
  )
  select
    count(*)::bigint as picks,
    round(100.0 * avg(won::int), 1) as win_rate,
    round(100.0 * avg(case when won then (1.0 / entry - 1) else -1 end), 1) as avg_return_pct,
    round(avg(entry), 4) as avg_entry,
    round(sum(case when won then 100 * (1.0 / entry - 1) else -100 end)) as flat100_pnl,
    (now() - interval '30 days')::date as since
  from mkt;
$$;

comment on function profit_bot_performance is 'Last-30-day results of the Profit Bot rules, flat $100 per resolved pick.';

grant select on proven_wallets to anon, authenticated;
grant execute on function profit_bot_picks() to anon, authenticated;
grant execute on function profit_bot_performance() to anon, authenticated;
