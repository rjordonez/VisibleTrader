-- Wallet lookup + manual tracking. Lets a user search the wallet directory
-- (by address or username) and, if a wallet isn't already tracked, add it —
-- after which it's unioned into live-signal-service.py's roster set and
-- behaves exactly like any other tracked wallet (shows up in Signals, gets
-- the "Tracked" badge on the ticker, etc.) with no separate code path.

-- ── wallet_directory ──
-- One-time (re-runnable) sync target for polymarket_users.json, populated
-- by scripts/sync_wallet_directory.py. Lets the browser search 286k wallets
-- without shipping the 241MB local JSON file anywhere.
create table wallet_directory (
  wallet text primary key,
  username text,
  x_username text,
  verified boolean,
  best_pnl numeric
);
create extension if not exists pg_trgm;
create index wallet_directory_username_trgm_idx on wallet_directory using gin (username gin_trgm_ops);
create index wallet_directory_best_pnl_idx on wallet_directory (best_pnl desc);
alter table wallet_directory enable row level security;
grant select on wallet_directory to anon, authenticated;
create policy "public read" on wallet_directory for select using (true);

-- ── tracked_wallets ──
-- Manually-added wallets. wallet is the primary key, so two users adding
-- the same wallet can only ever produce one row — no duplicate trackers.
create table tracked_wallets (
  wallet text primary key,
  added_at timestamptz not null default now(),
  added_by uuid references auth.users(id),
  last_active_at timestamptz
);
alter table tracked_wallets enable row level security;
grant select on tracked_wallets to anon, authenticated;
grant insert, delete on tracked_wallets to authenticated;
create policy "public read" on tracked_wallets for select using (true);
create policy "authenticated insert" on tracked_wallets for insert with check (auth.role() = 'authenticated');
create policy "authenticated delete" on tracked_wallets for delete using (auth.role() = 'authenticated');

-- ── wallet_pnl_rank ──
-- Cheap "would this wallet make the current top-N cut" check for the
-- Lookup page — uses the best_pnl index for a range-count instead of
-- ranking/sorting all 286k rows (the exact mistake fixed in
-- opportunities_live earlier, avoided here from the start).
create or replace function wallet_pnl_rank(target_wallet text)
returns bigint language sql stable security invoker as $$
  select count(*) + 1 from wallet_directory
  where best_pnl > (select best_pnl from wallet_directory where wallet = target_wallet)
$$;
