-- Persistent per-user trade history for connected Polymarket accounts, so
-- the journal's stats (days logged, profitable days, monthly P&L) can
-- reflect real trades instead of only the live 50-trade snapshot window.
-- Venue-agnostic schema; only 'us' rows are populated for now — Polymarket's
-- international Data API has no verified per-trade realized-pnl field yet,
-- so international backfill is intentionally out of scope until that's solved.
create table public.polymarket_trades (
  user_id uuid not null references auth.users(id) on delete cascade,
  venue text not null check (venue in ('international', 'us')),
  external_id text not null,
  occurred_at timestamptz not null,
  asset text not null,
  title text not null,
  outcome text not null,
  side text not null,
  size numeric,
  price numeric,
  amount numeric,
  realized_pnl numeric,
  synced_at timestamptz not null default now(),
  primary key (user_id, venue, external_id)
);
create index polymarket_trades_user_date_idx on public.polymarket_trades (user_id, occurred_at);
alter table public.polymarket_trades enable row level security;
revoke all on public.polymarket_trades from anon, authenticated;
grant select on public.polymarket_trades to authenticated;
grant all on public.polymarket_trades to service_role;
create policy "Read own Polymarket trades" on public.polymarket_trades
  for select to authenticated using ((select auth.uid()) = user_id);

alter table public.polymarket_us_connections
  add column backfill_status text not null default 'pending'
    check (backfill_status in ('pending', 'in_progress', 'done')),
  add column backfill_cursor text;
