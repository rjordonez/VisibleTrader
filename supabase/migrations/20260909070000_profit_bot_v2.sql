-- Profit Bot v2: widen the performance window to all tracked history (was
-- 30 days) and add a daily series so the Profits page can draw the strategy
-- equity curve the same way it draws the raw one. See
-- 20260909060000_profit_bot.sql for the rules.

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
    select ow.condition_id, ow.outcome, ow.wallet, ow.price, ow.resolved_win, ow.resolved_ts
    from opportunity_wallets ow
    join proven_wallets pw on pw.wallet = ow.wallet
    where ow.resolved_ts is not null
      and ow.price between 0.40 and 0.80
      and ow.usd >= 100
      and ow.closed_profit is not null
  ),
  mkt as (
    select condition_id, outcome,
      bool_or(resolved_win) as won,
      avg(price) as entry,
      max(resolved_ts) as rts
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
    min(rts)::date as since
  from mkt;
$$;

-- Daily flat-$100-per-pick P&L, one row per day a Profit Bot pick resolved.
create or replace function profit_bot_daily()
returns table (
  d date,
  day_pnl numeric,
  picks bigint
)
language sql
stable
as $$
  with base as (
    select ow.condition_id, ow.outcome, ow.wallet, ow.price, ow.resolved_win, ow.resolved_ts
    from opportunity_wallets ow
    join proven_wallets pw on pw.wallet = ow.wallet
    where ow.resolved_ts is not null
      and ow.price between 0.40 and 0.80
      and ow.usd >= 100
      and ow.closed_profit is not null
  ),
  mkt as (
    select condition_id, outcome,
      bool_or(resolved_win) as won,
      avg(price) as entry,
      max(resolved_ts)::date as d
    from base
    group by condition_id, outcome
    having count(distinct wallet) >= 3
  )
  select
    d,
    round(sum(case when won then 100 * (1.0 / entry - 1) else -100 end)) as day_pnl,
    count(*)::bigint as picks
  from mkt
  group by d
  order by d;
$$;

grant execute on function profit_bot_daily() to anon, authenticated;
