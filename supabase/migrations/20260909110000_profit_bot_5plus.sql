-- Tighten the Profit Bot consensus rule from 3+ to 5+ proven traders on a
-- side. Backtest of every resolved pick since Aug 1:
--   3+ threshold: ~19 picks/day, 63% win, +6% avg return per pick
--   5+ threshold: ~3 picks/day, 74% win, +22.6% avg return per pick
-- Fewer, much higher-quality picks. All four RPCs move to the 5+ bar.

create or replace function profit_bot_picks()
returns setof opportunities_live language sql stable as $$
  with agg as (
    select ow.condition_id, ow.outcome
    from opportunity_wallets ow
    join proven_wallets pw on pw.wallet = ow.wallet
    where ow.resolved_ts is null and ow.exit_ts is null
      and ow.price between 0.40 and 0.80 and ow.usd >= 100
    group by ow.condition_id, ow.outcome
    having count(distinct ow.wallet) >= 5
  )
  select o.*
  from opportunities_live o
  join agg a on a.condition_id = o.condition_id and a.outcome = o.outcome
  where o.latest_price between 0.08 and 0.94
  order by o.last_updated desc
  limit 40;
$$;

create or replace function profit_bot_resolved()
returns table (
  condition_id text, outcome text, title text, category text,
  experts int, avg_entry numeric, won boolean, pnl numeric, resolved_ts timestamptz
)
language sql stable as $$
  with base as (
    select ow.condition_id, ow.outcome, ow.wallet, ow.price, ow.resolved_win, ow.resolved_ts
    from opportunity_wallets ow
    join proven_wallets pw on pw.wallet = ow.wallet
    where ow.resolved_ts is not null and ow.price between 0.40 and 0.80
      and ow.usd >= 100 and ow.closed_profit is not null
  ),
  mkt as (
    select condition_id, outcome, count(distinct wallet) as k, bool_or(resolved_win) as won,
      avg(price) as entry, max(resolved_ts) as rts
    from base group by condition_id, outcome
    having count(distinct wallet) >= 5
  )
  select m.condition_id, m.outcome, coalesce(o.title, m.condition_id), o.category,
    m.k::int, round(m.entry, 4), m.won,
    round(case when m.won then 100 * (1.0 / m.entry - 1) else -100 end), m.rts
  from mkt m
  left join lateral (
    select title, category from opportunities
    where condition_id = m.condition_id and outcome = m.outcome
    order by is_current desc, last_updated desc nulls last limit 1
  ) o on true
  order by m.rts desc
  limit 60;
$$;

drop function if exists profit_bot_performance();
create function profit_bot_performance()
returns table (
  picks bigint, won bigint, lost bigint, win_rate numeric,
  avg_return_pct numeric, avg_entry numeric, flat100_pnl numeric, since date
)
language sql stable as $$
  with base as (
    select ow.condition_id, ow.outcome, ow.wallet, ow.price, ow.resolved_win, ow.resolved_ts
    from opportunity_wallets ow
    join proven_wallets pw on pw.wallet = ow.wallet
    where ow.resolved_ts is not null and ow.price between 0.40 and 0.80
      and ow.usd >= 100 and ow.closed_profit is not null
  ),
  mkt as (
    select condition_id, outcome, bool_or(resolved_win) as won, avg(price) as entry, max(resolved_ts) as rts
    from base group by condition_id, outcome
    having count(distinct wallet) >= 5
  )
  select
    count(*)::bigint,
    count(*) filter (where won)::bigint,
    count(*) filter (where not won)::bigint,
    round(100.0 * avg(won::int), 1),
    round(100.0 * avg(case when won then (1.0 / entry - 1) else -1 end), 1),
    round(avg(entry), 4),
    round(sum(case when won then 100 * (1.0 / entry - 1) else -100 end)),
    min(rts)::date
  from mkt;
$$;
grant execute on function profit_bot_performance() to anon, authenticated;

create or replace function profit_bot_daily()
returns table (d date, day_pnl numeric, picks bigint)
language sql stable as $$
  with base as (
    select ow.condition_id, ow.outcome, ow.wallet, ow.price, ow.resolved_win, ow.resolved_ts
    from opportunity_wallets ow
    join proven_wallets pw on pw.wallet = ow.wallet
    where ow.resolved_ts is not null and ow.price between 0.40 and 0.80
      and ow.usd >= 100 and ow.closed_profit is not null
  ),
  mkt as (
    select condition_id, outcome, bool_or(resolved_win) as won, avg(price) as entry, max(resolved_ts)::date as d
    from base group by condition_id, outcome
    having count(distinct wallet) >= 5
  )
  select d, round(sum(case when won then 100 * (1.0 / entry - 1) else -100 end)), count(*)::bigint
  from mkt group by d order by d;
$$;
grant execute on function profit_bot_daily() to anon, authenticated;
