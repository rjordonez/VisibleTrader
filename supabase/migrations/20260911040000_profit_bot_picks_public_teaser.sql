-- Profits is now the landing page, including for signed-in-but-unsubscribed
-- visitors (ProtectedRoute blurs the real page behind a "Subscribe to
-- unlock" overlay instead of showing a separate paywall — see
-- src/ProtectedRoute.tsx). The hero (profit_bot_performance/daily/resolved)
-- already reads from public-read cache tables, so it already showed real
-- numbers. But profit_bot_picks() joined live against opportunities_live,
-- which inherits opportunities' RLS ("public read" requires an active
-- subscription) — so the "Picks for today" grid, the most visually
-- prominent part of the blurred teaser, rendered empty for a locked
-- visitor. Everything else about `opportunities`/`expert_picks_open` stays
-- gated (this migration touches nothing there) — only Profit Bot's already-
-- curated picks become part of the public teaser, same as its performance
-- stats already are.
--
-- Fix: bake the display fields ExpertPickCard needs into
-- profit_bot_pick_keys (already `public read`, qual: true) at refresh time,
-- and have profit_bot_picks() read purely from that cache instead of
-- joining opportunities_live at request time.

alter table profit_bot_pick_keys
  add column if not exists title text,
  add column if not exists category text,
  add column if not exists slug text,
  add column if not exists event_slug text,
  add column if not exists latest_price numeric,
  add column if not exists cumulative_usd numeric,
  add column if not exists total_profit numeric,
  add column if not exists last_updated timestamptz;

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

  -- Open picks passing the same 5+ bar, now with the display fields the
  -- public profit_bot_picks() RPC serves straight from this table — no
  -- request-time join against the gated opportunities_live.
  delete from profit_bot_pick_keys;
  insert into profit_bot_pick_keys
    (condition_id, outcome, experts, updated_at,
     title, category, slug, event_slug, latest_price, cumulative_usd, total_profit, last_updated)
  select o.condition_id, o.outcome, agg.experts, now(),
    o.title, o.category, o.slug, o.event_slug, o.latest_price, o.cumulative_usd, o.total_profit, o.last_updated
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
end;
$$;

-- Return type is narrower than before (setof opportunities_live -> just the
-- fields ExpertPickCard/ProfitBot.tsx actually read), so drop first.
drop function if exists public.profit_bot_picks();

create function public.profit_bot_picks()
returns table(condition_id text, outcome text, title text, category text, slug text,
  event_slug text, latest_price numeric, cumulative_usd numeric, wallet_count integer,
  total_profit numeric, last_updated timestamptz)
language sql
stable
as $$
  select condition_id, outcome, title, category, slug, event_slug, latest_price,
    cumulative_usd, experts as wallet_count, total_profit, last_updated
  from profit_bot_pick_keys
  order by last_updated desc
  limit 40;
$$;

select refresh_profit_bot_cache();
