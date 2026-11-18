create or replace function public.trader_open_positions(p_wallets text[])
returns table (wallet text, positions integer, usd numeric)
language sql
stable
as $function$
  select ow.wallet, count(distinct (ow.condition_id, ow.outcome))::int, sum(ow.usd)
  from opportunity_wallets ow
  where ow.wallet = any(p_wallets[1:200])
    and ow.exit_ts is null and (ow.market_closed is null or ow.market_closed = false)
  group by ow.wallet
$function$;
grant execute on function public.trader_open_positions(text[]) to authenticated;
