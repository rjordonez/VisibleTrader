-- profit_bot_performance() gains won / lost pick counts so the Profits page
-- can show the same wins/losses split bar it shows for the raw feed.
drop function if exists profit_bot_performance();

create function profit_bot_performance()
returns table (
  picks bigint,
  won bigint,
  lost bigint,
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
    count(*) filter (where won)::bigint as won,
    count(*) filter (where not won)::bigint as lost,
    round(100.0 * avg(won::int), 1) as win_rate,
    round(100.0 * avg(case when won then (1.0 / entry - 1) else -1 end), 1) as avg_return_pct,
    round(avg(entry), 4) as avg_entry,
    round(sum(case when won then 100 * (1.0 / entry - 1) else -100 end)) as flat100_pnl,
    min(rts)::date as since
  from mkt;
$$;

grant execute on function profit_bot_performance() to anon, authenticated;
