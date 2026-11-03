-- Experts from anywhere on Polymarket, not just the wallets we track.
-- live-signal-service.py (discover_experts, every 6 hours) takes the
-- wallets on Polymarket's own P&L boards, drops volume bots, and scores each
-- on its closed positions via the Data API v2 (scripts/expert_scan.py):
-- 50+ markets of $50+, 5%+ return on what it staked, $25k+ profit, and a
-- per-market return t-statistic of 2.0+ (each market's return capped at 5x
-- so one long shot can't carry it). Listed by profit. The Leaderboard's Experts view reads
-- is_expert rows. trader_scores keeps scoring our own roster as before.

create table if not exists expert_traders (
  wallet         text primary key,
  wallet_name    text,
  positions      integer not null,
  wins           integer not null,
  win_rate       numeric not null,
  cost           numeric not null,
  pnl            numeric not null,
  roi            numeric not null,
  t_stat         numeric not null,
  avg_odds       numeric not null,
  is_expert      boolean not null,
  open_positions integer not null default 0,
  open_usd       numeric not null default 0,
  updated_at     timestamptz not null default now()
);
create index if not exists expert_traders_expert_idx on expert_traders (pnl desc) where is_expert;

alter table expert_traders enable row level security;
drop policy if exists "public read" on expert_traders;
create policy "public read" on expert_traders for select using (
  exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'))
);
grant select on expert_traders to authenticated;
