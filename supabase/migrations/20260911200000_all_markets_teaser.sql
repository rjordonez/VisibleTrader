-- "All markets" (the broad discovery browser on Profits) was fully empty for
-- locked visitors — expert_picks_open inherits opportunities' subscription-
-- gated RLS, same as Profit Bot's picks used to before
-- 20260911040000_profit_bot_picks_public_teaser.sql. Unlike that one, the
-- full feed (hundreds of rows) shouldn't all become public — cap it: a
-- bounded ~30-row snapshot, refreshed on the same cadence as the rest of
-- the public teaser cache, reusing the same public-cache pattern.

create table if not exists all_markets_teaser_cache (
  condition_id text not null,
  outcome text not null,
  title text,
  category text,
  slug text,
  event_slug text,
  latest_price numeric,
  cumulative_usd numeric,
  wallet_count bigint,
  total_profit numeric,
  last_updated timestamptz,
  best_win_rate numeric,
  primary key (condition_id, outcome)
);
alter table all_markets_teaser_cache enable row level security;
drop policy if exists "public read" on all_markets_teaser_cache;
create policy "public read" on all_markets_teaser_cache for select using (true);
grant select on all_markets_teaser_cache to anon, authenticated;

create or replace function public.all_markets_teaser()
returns table(condition_id text, outcome text, title text, category text, slug text,
  event_slug text, latest_price numeric, cumulative_usd numeric, wallet_count bigint,
  total_profit numeric, last_updated timestamptz, best_win_rate numeric)
language sql
stable
as $$
  select condition_id, outcome, title, category, slug, event_slug, latest_price,
    cumulative_usd, wallet_count, total_profit, last_updated, best_win_rate
  from all_markets_teaser_cache
  order by last_updated desc;
$$;

-- Extends the existing Profit Bot refresh (same ~120s cadence via
-- live-signal-service.py's refresh_profit_bot) rather than adding a new
-- job — one more cache table populated in the same pass.
create or replace function refresh_profit_bot_cache()
returns void
language plpgsql
as $$
begin
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

  delete from profit_bot_pick_keys;
  insert into profit_bot_pick_keys
    (condition_id, outcome, experts, updated_at,
     title, category, slug, event_slug, latest_price, cumulative_usd, total_profit, last_updated,
     best_win_rate)
  select o.condition_id, o.outcome, agg.experts, now(),
    o.title, o.category, o.slug, o.event_slug, o.latest_price, o.cumulative_usd, o.total_profit, o.last_updated,
    o.best_win_rate
  from (
    select ow.condition_id, ow.outcome, count(distinct ow.wallet)::int as experts
    from opportunity_wallets ow
    join proven_wallets pw on pw.wallet = ow.wallet
    where ow.resolved_ts is null and ow.exit_ts is null
      and ow.price between 0.40 and 0.80 and ow.usd >= 100
    group by ow.condition_id, ow.outcome
    having count(distinct ow.wallet) >= 5
  ) agg
  join opportunities_live o on o.condition_id = agg.condition_id and o.outcome = agg.outcome
  where o.latest_price between 0.08 and 0.94;

  -- All markets teaser: the broad feed, uncurated (no 5+ proven-wallet
  -- rule), capped to the 30 most recently active rows.
  delete from all_markets_teaser_cache;
  insert into all_markets_teaser_cache
    (condition_id, outcome, title, category, slug, event_slug, latest_price,
     cumulative_usd, wallet_count, total_profit, last_updated, best_win_rate)
  select condition_id, outcome, title, category, slug, event_slug, latest_price,
    cumulative_usd, wallet_count, total_profit, last_updated, best_win_rate
  from expert_picks_open
  order by last_updated desc
  limit 30;
end;
$$;

select refresh_profit_bot_cache();
