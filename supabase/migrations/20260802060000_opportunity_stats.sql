-- Step 4 of the Signals read-path scaling plan: schema only, additive,
-- zero behavior change until backfilled (step 5) and wired into the write
-- path (step 6) — opportunities_live still reads the old GROUP BY path
-- until step 7 cuts it over.
--
-- opportunity_stats is one row per (condition_id, outcome) — not columns
-- on `opportunities`, because `opportunities` has PK
-- (condition_id, outcome, tier): a new tier crossing inserts a NEW row
-- that would start aggregates at zero while the real accumulated state
-- lives on the previous max-tier row. This table sidesteps that
-- carry-forward hazard entirely.
create table opportunity_stats (
  condition_id text not null,
  outcome text not null,
  entries integer not null default 0,
  wallet_count integer not null default 0,
  cumulative_usd numeric not null default 0,
  exited integer not null default 0,
  scalped integer not null default 0,
  closed integer not null default 0,
  won integer not null default 0,
  lost integer not null default 0,
  -- total_profit = realized_profit + latest_price * open_shares_sum - open_invested_usd,
  -- computed at read time from these three running sums plus the
  -- already-stored opportunities.latest_price — mark-to-market price
  -- ticks never need to touch this table.
  realized_profit numeric not null default 0,
  open_shares_sum numeric not null default 0,
  open_invested_usd numeric not null default 0,
  best_win_rate numeric not null default 0,
  best_bet_ratio numeric not null default 0,
  updated_at timestamptz not null default now(),
  primary key (condition_id, outcome)
);
alter table opportunity_stats enable row level security;
grant select on opportunity_stats to anon, authenticated;
create policy "public read" on opportunity_stats for select using (true);

-- Tracks which wallets have ever contributed to a (condition_id, outcome),
-- used to (a) increment wallet_count without a COUNT(DISTINCT) scan, since
-- an INSERT ... ON CONFLICT DO NOTHING RETURNING tells us in one
-- statement whether this is a wallet's first touch of this market, and
-- (b) bound the best_win_rate/best_bet_ratio scan to distinct
-- market x wallet pairs instead of every trade row in opportunity_wallets.
create table opportunity_contributors (
  condition_id text not null,
  outcome text not null,
  wallet text not null,
  primary key (condition_id, outcome, wallet)
);
create index opportunity_contributors_co_idx on opportunity_contributors (condition_id, outcome);
alter table opportunity_contributors enable row level security;
grant select on opportunity_contributors to anon, authenticated;
create policy "public read" on opportunity_contributors for select using (true);

-- Replaces the view's `max_tier` GROUP BY CTE (the exact join shape that
-- caused a real 3.95s->21ms planner-misestimation incident, see
-- 20260728012207_fix_view_performance.sql) with a maintained flag, flipped
-- by record_tier_crossed instead of recomputed via MAX(tier) on every read.
alter table opportunities add column if not exists is_current boolean not null default true;

-- Correct the default for existing rows immediately — only the actual
-- max-tier row per (condition_id, outcome) should be current. New rows
-- inserted going forward are handled by record_tier_crossed (step 6), not
-- by this backfill.
with max_tier as (
  select condition_id, outcome, max(tier) as max_tier
  from opportunities group by condition_id, outcome
)
update opportunities o set is_current = false
where not exists (
  select 1 from max_tier m
  where m.condition_id = o.condition_id and m.outcome = o.outcome and m.max_tier = o.tier
);

create index opportunities_is_current_idx on opportunities (condition_id, outcome) where is_current = true;
