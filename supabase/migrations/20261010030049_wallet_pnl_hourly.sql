create table if not exists wallet_pnl_hourly (
  wallet text not null,
  h      timestamptz not null,
  profit numeric not null,
  n      integer not null,
  primary key (wallet, h)
);

alter table wallet_pnl_hourly enable row level security;
drop policy if exists "public read" on wallet_pnl_hourly;
create policy "public read" on wallet_pnl_hourly for select using (true);
grant select on wallet_pnl_hourly to anon, authenticated;

create table if not exists wallet_pnl_hourly_refresh_state (
  id boolean primary key default true check (id),
  last_resolved_ts timestamptz not null
);
alter table wallet_pnl_hourly_refresh_state enable row level security;

create or replace function public.refresh_wallet_pnl_hourly()
returns integer
language plpgsql
as $function$
declare
  v_last timestamptz;
  v_max timestamptz;
  v_rows integer;
begin
  perform pg_advisory_xact_lock(hashtext('wallet_pnl_hourly'));
  select last_resolved_ts into v_last from wallet_pnl_hourly_refresh_state where id;
  if v_last is null then
    return 0;
  end if;

  create temp table _pnl_delta on commit drop as
  select wallet, date_trunc('hour', resolved_ts) as h,
    sum(coalesce(closed_profit, case when resolved_win then usd / nullif(price, 0) - usd else -usd end)) as profit,
    count(*)::int as n,
    max(resolved_ts) as max_ts
  from opportunity_wallets
  where market_closed and wallet is not null and resolved_ts > v_last
  group by 1, 2;

  insert into wallet_pnl_hourly as t (wallet, h, profit, n)
  select wallet, h, coalesce(profit, 0), n from _pnl_delta order by wallet, h
  on conflict (wallet, h) do update set
    profit = t.profit + excluded.profit,
    n = t.n + excluded.n;
  get diagnostics v_rows = row_count;

  select max(max_ts) into v_max from _pnl_delta;
  if v_max is not null then
    update wallet_pnl_hourly_refresh_state set last_resolved_ts = v_max where id;
  end if;
  return v_rows;
end;
$function$;

create or replace function public.rebuild_wallet_pnl_hourly()
returns integer
language plpgsql
as $function$
declare
  v_max timestamptz;
  v_drift integer;
begin
  perform pg_advisory_xact_lock(hashtext('wallet_pnl_hourly'));
  select max(resolved_ts) into v_max from opportunity_wallets where market_closed;

  create temp table _pnl_full on commit drop as
  select wallet, date_trunc('hour', resolved_ts) as h,
    coalesce(sum(coalesce(closed_profit, case when resolved_win then usd / nullif(price, 0) - usd else -usd end)), 0) as profit,
    count(*)::int as n
  from opportunity_wallets
  where market_closed and wallet is not null and resolved_ts <= v_max
  group by 1, 2;

  select count(*) into v_drift
  from _pnl_full f full join wallet_pnl_hourly c on c.wallet = f.wallet and c.h = f.h
  where c.wallet is null or f.wallet is null or c.n <> f.n or round(c.profit, 2) <> round(f.profit, 2);

  delete from wallet_pnl_hourly;
  insert into wallet_pnl_hourly (wallet, h, profit, n)
  select wallet, h, profit, n from _pnl_full order by wallet, h;

  insert into wallet_pnl_hourly_refresh_state (id, last_resolved_ts)
  values (true, coalesce(v_max, '-infinity'))
  on conflict (id) do update set last_resolved_ts = excluded.last_resolved_ts;
  return v_drift;
end;
$function$;

select rebuild_wallet_pnl_hourly();
