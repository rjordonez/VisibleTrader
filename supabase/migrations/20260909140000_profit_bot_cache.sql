-- Profit Bot precompute.
--
-- The four profit_bot_* RPCs each ran opportunity_wallets JOIN proven_wallets
-- grouped by (condition_id, outcome) with a `count(distinct wallet) >= 5`
-- filter on every Profits-page load AND every 60s poll. That filter forces a
-- ~56k-row sort that spills to disk: profit_bot_resolved() measured ~11s cold,
-- profit_bot_daily() ~4s, and the page's Promise.all waits on the slowest.
--
-- Same fix as leaderboard_cache / refresh_leaderboard(): live-signal-service.py
-- calls refresh_profit_bot_cache() every ~2 min (PROFIT_BOT_REFRESH_SECONDS)
-- and the four RPCs become plain reads of these tables.

create table if not exists profit_bot_pick_keys (
  condition_id text not null,
  outcome      text not null,
  experts      integer not null,
  updated_at   timestamptz not null default now(),
  primary key (condition_id, outcome)
);

create table if not exists profit_bot_resolved_cache (
  condition_id text not null,
  outcome      text not null,
  title        text,
  category     text,
  experts      integer not null,
  avg_entry    numeric not null,
  won          boolean not null,
  pnl          numeric not null,
  resolved_ts  timestamptz not null,
  primary key (condition_id, outcome)
);

create table if not exists profit_bot_perf_cache (
  id             integer primary key default 1,
  picks          bigint not null,
  won            bigint not null,
  lost           bigint not null,
  win_rate       numeric,
  avg_return_pct numeric,
  avg_entry      numeric,
  flat100_pnl    numeric,
  since          date,
  updated_at     timestamptz not null default now(),
  constraint profit_bot_perf_cache_singleton check (id = 1)
);

create table if not exists profit_bot_daily_cache (
  d       date primary key,
  day_pnl numeric not null,
  picks   bigint not null
);

alter table profit_bot_pick_keys       enable row level security;
alter table profit_bot_resolved_cache  enable row level security;
alter table profit_bot_perf_cache       enable row level security;
alter table profit_bot_daily_cache      enable row level security;

drop policy if exists "public read" on profit_bot_pick_keys;
drop policy if exists "public read" on profit_bot_resolved_cache;
drop policy if exists "public read" on profit_bot_perf_cache;
drop policy if exists "public read" on profit_bot_daily_cache;
create policy "public read" on profit_bot_pick_keys      for select using (true);
create policy "public read" on profit_bot_resolved_cache for select using (true);
create policy "public read" on profit_bot_perf_cache     for select using (true);
create policy "public read" on profit_bot_daily_cache    for select using (true);

grant select on profit_bot_pick_keys, profit_bot_resolved_cache,
  profit_bot_perf_cache, profit_bot_daily_cache to anon, authenticated;

-- Recompute everything in one transaction so readers never see a half-written
-- state. Mirrors the CTEs the RPCs used to run inline (see
-- 20260909100000_profit_bot_picks_full.sql / 20260909110000_profit_bot_5plus.sql).
create or replace function refresh_profit_bot_cache()
returns void
language plpgsql
as $$
begin
  -- Resolved markets that cleared the 5+ proven-wallet consensus bar. Built
  -- once here and reused for the resolved list, headline perf and daily P&L.
  create temp table _pbot_mkt on commit drop as
  with base as (
    select ow.condition_id, ow.outcome, ow.wallet, ow.price, ow.resolved_win, ow.resolved_ts
    from opportunity_wallets ow
    join proven_wallets pw on pw.wallet = ow.wallet
    where ow.resolved_ts is not null and ow.price between 0.40 and 0.80
      and ow.usd >= 100 and ow.closed_profit is not null
  )
  select condition_id, outcome,
    count(distinct wallet)::int as k,
    bool_or(resolved_win) as won,
    avg(price) as entry,
    max(resolved_ts) as rts
  from base
  group by condition_id, outcome
  having count(distinct wallet) >= 5;

  delete from profit_bot_resolved_cache;
  insert into profit_bot_resolved_cache
    (condition_id, outcome, title, category, experts, avg_entry, won, pnl, resolved_ts)
  select m.condition_id, m.outcome, coalesce(o.title, m.condition_id), o.category,
    m.k, round(m.entry, 4), m.won,
    round(case when m.won then 100 * (1.0 / m.entry - 1) else -100 end), m.rts
  from _pbot_mkt m
  left join lateral (
    select title, category from opportunities
    where condition_id = m.condition_id and outcome = m.outcome
    order by is_current desc, last_updated desc nulls last
    limit 1
  ) o on true;

  insert into profit_bot_perf_cache as p
    (id, picks, won, lost, win_rate, avg_return_pct, avg_entry, flat100_pnl, since, updated_at)
  select 1,
    count(*),
    count(*) filter (where won),
    count(*) filter (where not won),
    round(100.0 * avg(won::int), 1),
    round(100.0 * avg(case when won then (1.0 / entry - 1) else -1 end), 1),
    round(avg(entry), 4),
    round(sum(case when won then 100 * (1.0 / entry - 1) else -100 end)),
    min(rts)::date,
    now()
  from _pbot_mkt
  on conflict (id) do update set
    picks = excluded.picks, won = excluded.won, lost = excluded.lost,
    win_rate = excluded.win_rate, avg_return_pct = excluded.avg_return_pct,
    avg_entry = excluded.avg_entry, flat100_pnl = excluded.flat100_pnl,
    since = excluded.since, updated_at = excluded.updated_at;

  delete from profit_bot_daily_cache;
  insert into profit_bot_daily_cache (d, day_pnl, picks)
  select rts::date,
    round(sum(case when won then 100 * (1.0 / entry - 1) else -100 end)),
    count(*)
  from _pbot_mkt
  group by rts::date;

  -- Open picks passing the same 5+ bar (mirrors profit_bot_picks' `agg` CTE).
  delete from profit_bot_pick_keys;
  insert into profit_bot_pick_keys (condition_id, outcome, experts, updated_at)
  select ow.condition_id, ow.outcome, count(distinct ow.wallet)::int, now()
  from opportunity_wallets ow
  join proven_wallets pw on pw.wallet = ow.wallet
  where ow.resolved_ts is null and ow.exit_ts is null
    and ow.price between 0.40 and 0.80 and ow.usd >= 100
  group by ow.condition_id, ow.outcome
  having count(distinct ow.wallet) >= 5;
end;
$$;

-- The four RPCs now just read the cache. Signatures unchanged.
create or replace function public.profit_bot_picks()
returns setof opportunities_live
language sql
stable
as $$
  select o.*
  from opportunities_live o
  join profit_bot_pick_keys k on k.condition_id = o.condition_id and k.outcome = o.outcome
  where o.latest_price between 0.08 and 0.94
  order by o.last_updated desc
  limit 40;
$$;

create or replace function public.profit_bot_resolved()
returns table(condition_id text, outcome text, title text, category text, experts integer,
  avg_entry numeric, won boolean, pnl numeric, resolved_ts timestamptz)
language sql
stable
as $$
  select condition_id, outcome, title, category, experts, avg_entry, won, pnl, resolved_ts
  from profit_bot_resolved_cache
  order by resolved_ts desc
  limit 60;
$$;

create or replace function public.profit_bot_performance()
returns table(picks bigint, won bigint, lost bigint, win_rate numeric, avg_return_pct numeric,
  avg_entry numeric, flat100_pnl numeric, since date)
language sql
stable
as $$
  select picks, won, lost, win_rate, avg_return_pct, avg_entry, flat100_pnl, since
  from profit_bot_perf_cache
  where id = 1;
$$;

create or replace function public.profit_bot_daily()
returns table(d date, day_pnl numeric, picks bigint)
language sql
stable
as $$
  select d, day_pnl, picks
  from profit_bot_daily_cache
  order by d;
$$;

-- Seed immediately so the tables aren't empty before the service's first pass.
select refresh_profit_bot_cache();
