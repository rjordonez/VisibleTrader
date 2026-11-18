alter table trader_scores
  add column if not exists open_positions integer not null default 0,
  add column if not exists open_usd numeric not null default 0;

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
    select ow.wallet, count(distinct (ow.condition_id, ow.outcome))::int as positions, sum(ow.usd) as usd
    from opportunity_wallets ow
    where ow.wallet = any(v_wallets)
      and ow.exit_ts is null and (ow.market_closed is null or ow.market_closed = false)
    group by ow.wallet
  ) o on o.wallet = w.wallet
  where t.wallet = w.wallet;
  get diagnostics v_rows = row_count;

  update trader_scores set open_positions = 0, open_usd = 0
  where open_positions > 0 and wallet <> all(v_wallets);
  return v_rows;
end;
$function$;

select refresh_trader_open_positions();
