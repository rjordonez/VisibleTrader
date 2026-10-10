-- Profit Bot track record at the price a follower could actually get, from
-- launch. Every resolved pick's entry (avg_entry) and pnl now use the 5th
-- proven wallet's first entry price instead of the average across all of
-- them (which includes cheaper earlier entries nobody following the bot can
-- get), and only picks opened since the Sept 9 launch count. Flows through
-- the resolved list, the perf stats, the daily P&L and the compounding chart.
-- The incremental path in live-signal-service.py mirrors this.

create or replace function public.refresh_profit_bot_cache()
returns void
language plpgsql
as $function$
begin
  create temp table _pbot_mkt on commit drop as
  with base as (
    select ow.condition_id, ow.outcome, ow.wallet, ow.price, ow.resolved_win, ow.resolved_ts, ow.ts
    from opportunity_wallets ow
    join proven_wallets pw on pw.wallet = ow.wallet
    where ow.resolved_ts is not null and ow.price between 0.40 and 0.80
      and ow.usd >= 100 and ow.closed_profit is not null
  ),
  -- Each wallet's first qualifying entry (time and price); the pick opens at
  -- the 5th one, and that's the price a follower could actually get.
  firsts as (
    select condition_id, outcome, wallet, min(ts) as ts,
      (array_agg(price order by ts))[1] as price,
      row_number() over (partition by condition_id, outcome order by min(ts)) as rn
    from base
    group by condition_id, outcome, wallet
  ),
  opened as (select condition_id, outcome, ts, price from firsts where rn = 5)
  select b.condition_id, b.outcome,
    count(distinct b.wallet)::int as k,
    bool_or(b.resolved_win) as won,
    max(op.price) as entry,
    max(b.resolved_ts) as rts,
    max(op.ts) as ots
  from base b
  join opened op on op.condition_id = b.condition_id and op.outcome = b.outcome
  -- Track record starts at the Profit Bot's launch.
  where op.ts >= timestamptz '2026-09-09'
  group by b.condition_id, b.outcome
  having count(distinct b.wallet) >= 5;

  delete from profit_bot_resolved_cache;
  insert into profit_bot_resolved_cache
    (condition_id, outcome, title, category, experts, avg_entry, won, pnl, resolved_ts, opened_ts)
  select m.condition_id, m.outcome, coalesce(o.title, m.condition_id), o.category,
    m.k, round(m.entry, 4), m.won,
    round(case when m.won then 100 * (1.0 / m.entry - 1) else -100 end), m.rts, m.ots
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
  -- rule), but still floored at wallet_count >= 4 and cumulative_usd >=
  -- $1,000 so the free preview showcases real conviction instead of
  -- 1-wallet, single-digit-dollar noise (which is most of the raw feed).
  delete from all_markets_teaser_cache;
  insert into all_markets_teaser_cache
    (condition_id, outcome, title, category, slug, event_slug, latest_price,
     cumulative_usd, wallet_count, total_profit, last_updated, best_win_rate)
  select condition_id, outcome, title, category, slug, event_slug, latest_price,
    cumulative_usd, wallet_count, total_profit, last_updated, best_win_rate
  from expert_picks_open
  where wallet_count >= 4 and cumulative_usd >= 1000
  order by last_updated desc
  limit 30;
end;
$function$;

select refresh_profit_bot_cache();
