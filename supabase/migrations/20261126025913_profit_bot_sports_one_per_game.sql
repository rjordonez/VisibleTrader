-- Profit Bot: sports only, at most one pick per game.
--
-- Tested on the bot's resolved picks, split at Nov 1 so a rule only counts if
-- it helps in both halves (flat $100 per pick):
--                          before Nov 1             Nov 1 on
--   7 traders (previous)   +24.4%/pick, dd $802     +21.4%/pick, dd $814, worst day -$446
--   sports, 1 per game     +26.5%/pick, dd $407     +25.4%/pick, dd $341, worst day -$233
-- Same picks restaked at 10% of free cash: $10 -> $146k with a 55% drawdown
-- before, $10 -> $600k with a 31% drawdown now.

create or replace function public.refresh_profit_bot_cache()
returns void
language plpgsql
set search_path to 'public', 'pg_temp'
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
  -- the 7th one, and that's the price a follower could actually get.
  firsts as (
    select condition_id, outcome, wallet, min(ts) as ts,
      (array_agg(price order by ts))[1] as price,
      row_number() over (partition by condition_id, outcome order by min(ts)) as rn
    from base
    group by condition_id, outcome, wallet
  ),
  opened as (select condition_id, outcome, ts, price from firsts where rn = 7)
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
  having count(distinct b.wallet) >= 7;

  -- When proven traders qualify on more than one side of a market, keep
  -- only the side with strictly more of them and drop ties. Showing both
  -- sides guaranteed a follower one loss per market: those picks went ~50%
  -- and lost money every week, while the majority side alone stays positive.
  delete from _pbot_mkt m
  where exists (
    select 1 from _pbot_mkt o
    where o.condition_id = m.condition_id and o.outcome <> m.outcome and o.k >= m.k
  );

  -- Sports only, and at most one pick per game (the side with the most
  -- proven traders; earliest opened on a tie). Several picks on the same game
  -- (moneyline, spread, total) win or lose together, which is what made the
  -- bad nights so deep; non-sports picks had also stopped earning.
  alter table _pbot_mkt add column title text, add column category text, add column event_slug text;
  update _pbot_mkt m set (title, category, event_slug) = (
    select o.title, o.category, coalesce(o.event_slug, m.condition_id) from opportunities o
    where o.condition_id = m.condition_id and o.outcome = m.outcome
    order by o.is_current desc, o.last_updated desc nulls last
    limit 1
  );
  delete from _pbot_mkt where category is distinct from 'sports';
  delete from _pbot_mkt m
  where exists (
    select 1 from _pbot_mkt o
    where o.event_slug = m.event_slug
      and (o.condition_id, o.outcome) <> (m.condition_id, m.outcome)
      and (o.k > m.k or (o.k = m.k and (o.ots, o.condition_id, o.outcome) < (m.ots, m.condition_id, m.outcome)))
  );

  delete from profit_bot_resolved_cache;
  insert into profit_bot_resolved_cache
    (condition_id, outcome, title, category, experts, avg_entry, won, pnl, resolved_ts, opened_ts)
  select m.condition_id, m.outcome, coalesce(m.title, m.condition_id), m.category,
    m.k, round(m.entry, 4), m.won,
    round(case when m.won then 100 * (1.0 / m.entry - 1) else -100 end), m.rts, m.ots
  from _pbot_mkt m;

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
  with agg as (
    select ow.condition_id, ow.outcome, count(distinct ow.wallet)::int as experts
    from opportunity_wallets ow
    join proven_wallets pw on pw.wallet = ow.wallet
    where ow.resolved_ts is null and ow.exit_ts is null
      and ow.price between 0.40 and 0.80 and ow.usd >= 100
    group by ow.condition_id, ow.outcome
    having count(distinct ow.wallet) >= 7
  )
  , cand as (
    select o.condition_id, o.outcome, agg.experts,
      o.title, o.category, o.slug, o.event_slug, o.latest_price, o.cumulative_usd, o.total_profit, o.last_updated,
      o.best_win_rate,
      -- Same one-pick-per-game rule as the track record above.
      row_number() over (
        partition by coalesce(o.event_slug, o.condition_id)
        order by agg.experts desc, o.condition_id, o.outcome
      ) as game_rank
    from agg
    join opportunities_live o on o.condition_id = agg.condition_id and o.outcome = agg.outcome
    -- Same one-side rule as the track record above.
    where not exists (
        select 1 from agg other
        where other.condition_id = agg.condition_id and other.outcome <> agg.outcome
          and other.experts >= agg.experts
      )
      -- The track record only counts entries at 40-80c, so only show picks a
      -- follower can still buy in that range. Above 80c there's little left to
      -- win; below 40c the market has moved against the traders.
      and o.latest_price between 0.40 and 0.80
      and o.category = 'sports'
  )
  select condition_id, outcome, experts, now(),
    title, category, slug, event_slug, latest_price, cumulative_usd, total_profit, last_updated,
    best_win_rate
  from cand
  where game_rank = 1;

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
