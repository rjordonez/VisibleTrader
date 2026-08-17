-- best_win_rate/best_bet_ratio in opportunities_live were computed via CTEs
-- re-aggregated on *every single request* (see 20260817000000, which fixed
-- the LATERAL-per-row version of this same problem). That got the warm-cache
-- case to ~0.6s, but a cold/fresh connection under real traffic still pays
-- the full recompute cost (~312k-row scan for best_bet_ratio) and can spike
-- past 9s -- verified live, past PostgREST's 8s statement_timeout, causing
-- the exact 57014 -> 500 failure this codebase already hit once before.
--
-- Precomputing into real tables, refreshed on a schedule by
-- live-signal-service.py (see refresh_opportunity_aggregates() there) rather
-- than per-request, turns opportunities_live's join into a plain indexed
-- lookup with no aggregation at query time at all -- consistently fast
-- regardless of connection/cache state. Same "public read" RLS pattern as
-- every sibling product table (see 20260809000000).
create table opportunity_best_win_rate (
  condition_id text not null,
  outcome text not null,
  best_win_rate numeric,
  updated_at timestamptz not null default now(),
  primary key (condition_id, outcome)
);
alter table opportunity_best_win_rate enable row level security;
create policy "public read" on opportunity_best_win_rate for select using (
  exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'))
);

create table opportunity_best_bet_ratio (
  condition_id text not null,
  outcome text not null,
  best_bet_ratio numeric,
  updated_at timestamptz not null default now(),
  primary key (condition_id, outcome)
);
alter table opportunity_best_bet_ratio enable row level security;
create policy "public read" on opportunity_best_bet_ratio for select using (
  exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'))
);

-- One-time backfill so these aren't empty until the backend's first refresh
-- cycle runs — same aggregation logic the old CTEs used, verified via a
-- direct diff (0 mismatches across all 25,253 current rows) before this
-- migration was written.
insert into opportunity_best_win_rate (condition_id, outcome, best_win_rate)
select oc.condition_id, oc.outcome,
  max(case when (ls.won + ls.lost) > 0 then ls.won::numeric / (ls.won + ls.lost)::numeric else null end)
from opportunity_contributors oc
left join leaderboard ls on ls.wallet = oc.wallet
group by oc.condition_id, oc.outcome;

insert into opportunity_best_bet_ratio (condition_id, outcome, best_bet_ratio)
select ow.condition_id, ow.outcome, max(ow.usd / wb.usdc_balance)
from opportunity_wallets ow
join wallet_balances wb on wb.wallet = ow.wallet and wb.usdc_balance >= 1
group by ow.condition_id, ow.outcome;

create or replace view opportunities_live with (security_invoker = true) as
select o.id, o.condition_id, o.outcome, o.slug, o.title, o.tier, o.first_seen, o.last_updated, o.latest_price, o.category,
  coalesce(s.wallet_count, o.wallet_count)::bigint as wallet_count,
  coalesce(s.cumulative_usd, o.cumulative_usd) as cumulative_usd,
  coalesce(s.entries, 0)::bigint as entries,
  coalesce(s.exited, 0)::bigint as exited,
  coalesce(s.scalped, 0)::bigint as scalped,
  coalesce(s.closed, 0)::bigint as closed,
  coalesce(s.won, 0)::bigint as won,
  coalesce(s.lost, 0)::bigint as lost,
  coalesce(s.realized_profit, 0::numeric) + coalesce(o.latest_price, 0::numeric) * coalesce(s.open_shares_sum, 0::numeric) - coalesce(s.open_invested_usd, 0::numeric) as total_profit,
  coalesce(b.best_win_rate, 0::numeric) as best_win_rate,
  coalesce(br.best_bet_ratio, 0::numeric) as best_bet_ratio,
  o.event_slug
from opportunities o
left join opportunity_stats s on s.condition_id = o.condition_id and s.outcome = o.outcome
left join opportunity_best_win_rate b on b.condition_id = o.condition_id and b.outcome = o.outcome
left join opportunity_best_bet_ratio br on br.condition_id = o.condition_id and br.outcome = o.outcome
where o.is_current = true;
