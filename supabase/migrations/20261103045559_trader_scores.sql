create table if not exists trader_market_results (
  wallet       text not null,
  condition_id text not null,
  outcome      text not null,
  category     text not null,
  usd          numeric not null,
  shares       numeric not null,
  won          boolean not null,
  first_ts     timestamptz,
  resolved_ts  timestamptz,
  primary key (wallet, condition_id, outcome)
);
alter table trader_market_results enable row level security;

create table if not exists trader_scores (
  wallet            text primary key,
  wallet_name       text,
  markets           integer not null,
  wins              integer not null,
  expected_wins     numeric not null,
  deployed          numeric not null,
  pnl               numeric not null,
  edge_pts          numeric not null,
  z                 numeric,
  longshots         integer not null,
  longshot_wins     integer not null,
  longshot_expected numeric not null,
  longshot_pnl      numeric not null,
  insider_z         numeric,
  is_expert         boolean not null,
  is_insider        boolean not null,
  updated_at        timestamptz not null default now()
);
create index if not exists trader_scores_expert_idx on trader_scores (edge_pts desc) where is_expert;
create index if not exists trader_scores_insider_idx on trader_scores (insider_z desc) where is_insider;
create index if not exists trader_scores_pnl_idx on trader_scores (pnl desc);

alter table trader_scores enable row level security;
drop policy if exists "public read" on trader_scores;
create policy "public read" on trader_scores for select using (
  exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'))
);
grant select on trader_scores to authenticated;

create table if not exists trader_scores_refresh_state (
  id boolean primary key default true check (id),
  last_resolved_ts timestamptz not null
);
alter table trader_scores_refresh_state enable row level security;

create or replace view trader_scores_compute as
with pos as (
  select r.*, r.usd / r.shares as p,
    r.category not in ('sports', 'esports', 'weather', 'crypto')
      and r.usd / r.shares <= 0.40 and r.usd >= 1000 as longshot
  from trader_market_results r
  where r.shares > 0
),
agg as (
  select wallet,
    count(*)::int as markets,
    (count(*) filter (where won))::int as wins,
    sum(p) as expected_wins,
    sum(p * (1 - p)) as variance,
    sum(usd) as deployed,
    sum(case when won then shares - usd else -usd end) as pnl,
    (count(*) filter (where longshot))::int as longshots,
    (count(*) filter (where longshot and won))::int as longshot_wins,
    coalesce(sum(p) filter (where longshot), 0) as longshot_expected,
    sum(p * (1 - p)) filter (where longshot) as longshot_variance,
    coalesce(sum(case when won then shares - usd else -usd end) filter (where longshot), 0) as longshot_pnl
  from pos
  group by wallet
),
scored as (
  select a.*,
    (a.wins - a.expected_wins) / a.markets * 100 as edge_pts,
    (a.wins - a.expected_wins) / nullif(sqrt(a.variance), 0) as z,
    (a.longshot_wins - a.longshot_expected) / nullif(sqrt(a.longshot_variance), 0) as insider_z
  from agg a
)
select s.wallet, l.wallet_name, s.markets, s.wins, s.expected_wins, s.deployed, s.pnl,
  s.edge_pts, s.z, s.longshots, s.longshot_wins, s.longshot_expected, s.longshot_pnl, s.insider_z,
  (s.markets >= 25 and s.edge_pts >= 5 and coalesce(s.z, 0) >= 2 and s.pnl > 0) as is_expert,
  (s.longshot_wins >= 1 and s.longshot_pnl >= 5000 and coalesce(s.insider_z, 0) >= 1.5) as is_insider
from scored s
left join leaderboard_cache l on l.wallet = s.wallet;
revoke all on trader_scores_compute from anon, authenticated;

create or replace function public.refresh_trader_scores()
returns integer
language plpgsql
as $function$
declare
  v_last timestamptz;
  v_max timestamptz;
  v_rows integer;
begin
  perform pg_advisory_xact_lock(hashtext('trader_scores'));
  select last_resolved_ts into v_last from trader_scores_refresh_state where id;
  if v_last is null then
    return 0;
  end if;

  create temp table _ts_delta on commit drop as
  select ow.wallet, ow.condition_id, ow.outcome,
    coalesce(max(o.category), 'other') as category,
    sum(ow.usd) as usd, sum(ow.usd / ow.price) as shares,
    bool_or(ow.resolved_win) as won,
    min(ow.ts) as first_ts, max(ow.resolved_ts) as resolved_ts
  from opportunity_wallets ow
  left join opportunities o on o.condition_id = ow.condition_id and o.outcome = ow.outcome and o.is_current
  where ow.market_closed and ow.wallet is not null and ow.resolved_win is not null
    and ow.price > 0 and ow.price < 1 and ow.resolved_ts > v_last
  group by 1, 2, 3;

  insert into trader_market_results as t
  select * from _ts_delta order by wallet, condition_id, outcome
  on conflict (wallet, condition_id, outcome) do update set
    usd = t.usd + excluded.usd,
    shares = t.shares + excluded.shares,
    won = t.won or excluded.won,
    first_ts = least(t.first_ts, excluded.first_ts),
    resolved_ts = greatest(t.resolved_ts, excluded.resolved_ts);

  insert into trader_scores as t (wallet, wallet_name, markets, wins, expected_wins, deployed, pnl,
    edge_pts, z, longshots, longshot_wins, longshot_expected, longshot_pnl, insider_z, is_expert, is_insider)
  select c.wallet, c.wallet_name, c.markets, c.wins, c.expected_wins, c.deployed, c.pnl,
    c.edge_pts, c.z, c.longshots, c.longshot_wins, c.longshot_expected, c.longshot_pnl, c.insider_z, c.is_expert, c.is_insider
  from trader_scores_compute c
  where c.wallet in (select distinct wallet from _ts_delta)
  order by c.wallet
  on conflict (wallet) do update set
    wallet_name = excluded.wallet_name, markets = excluded.markets, wins = excluded.wins,
    expected_wins = excluded.expected_wins, deployed = excluded.deployed, pnl = excluded.pnl,
    edge_pts = excluded.edge_pts, z = excluded.z, longshots = excluded.longshots,
    longshot_wins = excluded.longshot_wins, longshot_expected = excluded.longshot_expected,
    longshot_pnl = excluded.longshot_pnl, insider_z = excluded.insider_z,
    is_expert = excluded.is_expert, is_insider = excluded.is_insider, updated_at = now();
  get diagnostics v_rows = row_count;

  select max(resolved_ts) into v_max from _ts_delta;
  if v_max is not null then
    update trader_scores_refresh_state set last_resolved_ts = v_max where id;
  end if;
  return v_rows;
end;
$function$;

create or replace function public.rebuild_trader_scores()
returns integer
language plpgsql
as $function$
declare
  v_max timestamptz;
  v_rows integer;
begin
  perform pg_advisory_xact_lock(hashtext('trader_scores'));
  select max(resolved_ts) into v_max from opportunity_wallets where market_closed;

  delete from trader_market_results;
  insert into trader_market_results
  select ow.wallet, ow.condition_id, ow.outcome,
    coalesce(max(o.category), 'other'),
    sum(ow.usd), sum(ow.usd / ow.price),
    bool_or(ow.resolved_win),
    min(ow.ts), max(ow.resolved_ts)
  from opportunity_wallets ow
  left join opportunities o on o.condition_id = ow.condition_id and o.outcome = ow.outcome and o.is_current
  where ow.market_closed and ow.wallet is not null and ow.resolved_win is not null
    and ow.price > 0 and ow.price < 1 and ow.resolved_ts <= v_max
  group by 1, 2, 3;

  delete from trader_scores;
  insert into trader_scores (wallet, wallet_name, markets, wins, expected_wins, deployed, pnl,
    edge_pts, z, longshots, longshot_wins, longshot_expected, longshot_pnl, insider_z, is_expert, is_insider)
  select wallet, wallet_name, markets, wins, expected_wins, deployed, pnl,
    edge_pts, z, longshots, longshot_wins, longshot_expected, longshot_pnl, insider_z, is_expert, is_insider
  from trader_scores_compute order by wallet;
  get diagnostics v_rows = row_count;

  insert into trader_scores_refresh_state (id, last_resolved_ts)
  values (true, coalesce(v_max, '-infinity'))
  on conflict (id) do update set last_resolved_ts = excluded.last_resolved_ts;
  return v_rows;
end;
$function$;
