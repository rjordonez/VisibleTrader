-- leaderboard was a plain view doing a live SUM/COUNT GROUP BY over the
-- entire opportunity_wallets table (650k+ rows and growing) on every single
-- request -- both the Leaderboard page itself and every join against
-- leaderboard elsewhere (opportunities_live's best_win_rate precompute,
-- wallet_balances' bet_ratio/win_ratio, opportunity_aggregates). Same shape
-- of problem as best_win_rate/best_bet_ratio, fixed the same way (see
-- 20260817010000_precompute_opportunity_aggregates.sql): precompute into a
-- real table, refreshed on a schedule by live-signal-service.py (see
-- refresh_leaderboard() there), so every reader does a plain indexed lookup
-- instead of a live aggregation. Same "public read" RLS pattern as every
-- sibling product table.
create table leaderboard_cache (
  wallet text primary key,
  wallet_name text,
  n bigint not null,
  won bigint not null,
  lost bigint not null,
  deployed numeric not null,
  won_usd numeric not null,
  net_profit numeric not null,
  updated_at timestamptz not null default now()
);
alter table leaderboard_cache enable row level security;
create policy "public read" on leaderboard_cache for select using (
  exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'))
);

-- One-time backfill so the cache isn't empty until the backend's first
-- refresh cycle runs -- identical aggregation to the view this replaces.
insert into leaderboard_cache (wallet, wallet_name, n, won, lost, deployed, won_usd, net_profit)
select wallet, MAX(wallet_name) AS wallet_name,
  COUNT(*) AS n,
  SUM(CASE WHEN resolved_win = true THEN 1 ELSE 0 END) AS won,
  SUM(CASE WHEN resolved_win = false THEN 1 ELSE 0 END) AS lost,
  SUM(usd) AS deployed,
  SUM(CASE WHEN resolved_win = true THEN usd ELSE 0 END) AS won_usd,
  SUM(CASE WHEN resolved_win = true THEN (usd / price) - usd ELSE -usd END) AS net_profit
from opportunity_wallets
where market_closed = true and wallet is not null
group by wallet;

-- leaderboard keeps its name (and exact column shape) so every existing
-- join/select against it -- opportunities_live's precompute, wallet_balances,
-- opportunity_aggregates, LeaderboardPage.tsx -- keeps working unchanged;
-- it's now a plain passthrough over the cached table instead of a live
-- aggregate, so security_invoker still correctly gates reads via
-- leaderboard_cache's own RLS above.
create or replace view leaderboard with (security_invoker = true) as
  select wallet, wallet_name, n, won, lost, deployed, won_usd, net_profit from leaderboard_cache;
