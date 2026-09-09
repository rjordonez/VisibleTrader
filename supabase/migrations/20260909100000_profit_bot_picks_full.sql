-- profit_bot_picks() now returns the full opportunities_live row for each
-- matching market, so the Profits page can render the picks with the same
-- ExpertPickCard component the Signals page uses (chart, invested / experts
-- / tracked profit, Bet YES/NO). Same rules as before: an open market where
-- 3+ proven wallets are on a side at 40-80c entry with >=$100 size.
drop function if exists profit_bot_picks();

create function profit_bot_picks()
returns setof opportunities_live
language sql
stable
as $$
  with agg as (
    select ow.condition_id, ow.outcome
    from opportunity_wallets ow
    join proven_wallets pw on pw.wallet = ow.wallet
    where ow.resolved_ts is null
      and ow.exit_ts is null
      and ow.price between 0.40 and 0.80
      and ow.usd >= 100
    group by ow.condition_id, ow.outcome
    having count(distinct ow.wallet) >= 3
  )
  select o.*
  from opportunities_live o
  join agg a on a.condition_id = o.condition_id and a.outcome = o.outcome
  where o.latest_price between 0.08 and 0.94
  order by o.last_updated desc
  limit 40;
$$;

grant execute on function profit_bot_picks() to anon, authenticated;
