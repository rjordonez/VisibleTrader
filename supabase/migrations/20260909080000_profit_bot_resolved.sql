-- Profit Bot: the resolved side of the picks list. Same rules as
-- profit_bot_picks() but for markets that have already settled — market,
-- side, avg entry, won/lost, and the flat-$100 P&L. Powers the
-- "Ongoing / Resolved" toggle on the Profits page.
create or replace function profit_bot_resolved()
returns table (
  condition_id text,
  outcome text,
  title text,
  category text,
  experts int,
  avg_entry numeric,
  won boolean,
  pnl numeric,
  resolved_ts timestamptz
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
      count(distinct wallet) as k,
      bool_or(resolved_win) as won,
      avg(price) as entry,
      max(resolved_ts) as rts
    from base
    group by condition_id, outcome
    having count(distinct wallet) >= 3
  )
  select
    m.condition_id, m.outcome,
    coalesce(o.title, m.condition_id) as title, o.category,
    m.k::int as experts,
    round(m.entry, 4) as avg_entry,
    m.won,
    round(case when m.won then 100 * (1.0 / m.entry - 1) else -100 end) as pnl,
    m.rts as resolved_ts
  from mkt m
  left join lateral (
    select title, category
    from opportunities
    where condition_id = m.condition_id and outcome = m.outcome
    order by is_current desc, last_updated desc nulls last
    limit 1
  ) o on true
  order by m.rts desc
  limit 60;
$$;

grant execute on function profit_bot_resolved() to anon, authenticated;
