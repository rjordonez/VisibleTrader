-- wallet_category_breakdown was a live GROUP BY joining opportunity_wallets
-- against a re-aggregated "one category per market" subquery over the
-- *entire* opportunities table (72k+ rows) -- recomputed from scratch on
-- every single call regardless of which wallet was asked about. Verified
-- live at ~2.4s for a high-volume wallet (136k trades), the largest single
-- contributor to TraderDetailPage's load time. Same fix as leaderboard (see
-- 20260830000000_precompute_leaderboard.sql): precompute into a real table,
-- refreshed on a schedule by live-signal-service.py.
create table wallet_category_breakdown_cache (
  wallet text not null,
  category text not null,
  n bigint not null,
  won bigint not null,
  lost bigint not null,
  profit numeric not null,
  updated_at timestamptz not null default now(),
  primary key (wallet, category)
);
alter table wallet_category_breakdown_cache enable row level security;
create policy "public read" on wallet_category_breakdown_cache for select using (
  exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'))
);

insert into wallet_category_breakdown_cache (wallet, category, n, won, lost, profit)
select ow.wallet, coalesce(o.category, 'other') as category,
  count(*) as n,
  sum(case when ow.resolved_win = true then 1 else 0 end) as won,
  sum(case when ow.resolved_win = false then 1 else 0 end) as lost,
  sum(case when ow.resolved_win = true then (ow.usd / ow.price) - ow.usd else -ow.usd end) as profit
from opportunity_wallets ow
join (select condition_id, outcome, max(category) as category from opportunities group by condition_id, outcome) o
  on o.condition_id = ow.condition_id and o.outcome = ow.outcome
where ow.market_closed = true
group by ow.wallet, o.category;

-- wallet_category_breakdown keeps its name/shape so TraderDetailPage.tsx and
-- the wallet-search Edge Function keep working unchanged; it's now a plain
-- passthrough over the cached table instead of a live aggregate.
create or replace view wallet_category_breakdown with (security_invoker = true) as
  select wallet, category, n, won, lost, profit from wallet_category_breakdown_cache;

-- wallet_positions' `WHERE wallet = ... ORDER BY resolved_ts DESC LIMIT n`
-- pattern (TraderDetailPage, wallet-search) had no index satisfying both the
-- filter and the sort together, so the planner scanned the existing
-- resolved_ts index and filtered by wallet row-by-row -- for the same
-- 136k-trade wallet this touched ~250k rows to find 1000 matches (~760ms).
-- This composite index satisfies both at once, turning it into a direct
-- index scan with no extra filtering or sort.
create index opportunity_wallets_wallet_resolved_idx on opportunity_wallets (wallet, resolved_ts desc) where market_closed = true;
