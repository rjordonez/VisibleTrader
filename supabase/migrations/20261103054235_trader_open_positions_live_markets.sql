create or replace function public.refresh_trader_open_positions()
returns integer
language plpgsql
as $function$
declare
  v_wallets text[];
  v_rows integer;
begin
  select array_agg(wallet) into v_wallets from (
    select wallet from trader_scores where is_expert or is_insider
    union
    (select wallet from trader_scores order by pnl desc limit 100)
  ) w;

  update trader_scores t set
    open_positions = coalesce(o.positions, 0),
    open_usd = coalesce(o.usd, 0)
  from unnest(v_wallets) as w(wallet)
  left join (
    select p.wallet, count(*)::int as positions, sum(p.usd) as usd
    from (
      select ow.wallet, ow.condition_id, ow.outcome, sum(ow.usd) as usd
      from opportunity_wallets ow
      where ow.wallet = any(v_wallets)
        and ow.exit_ts is null and (ow.market_closed is null or ow.market_closed = false)
      group by 1, 2, 3
    ) p
    join opportunities op on op.condition_id = p.condition_id and op.outcome = p.outcome and op.is_current
    where op.latest_price > 0.02 and op.latest_price < 0.98
    group by p.wallet
  ) o on o.wallet = w.wallet
  where t.wallet = w.wallet;
  get diagnostics v_rows = row_count;

  update trader_scores set open_positions = 0, open_usd = 0
  where open_positions > 0 and wallet <> all(v_wallets);
  return v_rows;
end;
$function$;
