-- Personal watchlist: bookmark specific signals (Vetted Picks) for easy
-- revisiting. Unlike tracked_wallets (a shared list any signed-in user can
-- add to), this is per-user — real RLS ownership via auth.uid() = user_id,
-- not just an authenticated-role gate, since tracked picks must only be
-- visible to the user who tracked them. No notifications/alerts hookup —
-- this is a plain watchlist, nothing more.
create table tracked_picks (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  condition_id text not null,
  outcome text not null,
  added_at timestamptz not null default now(),
  unique (user_id, condition_id, outcome)
);
alter table tracked_picks enable row level security;
grant select, insert, delete on tracked_picks to authenticated;
create policy "own rows only" on tracked_picks for select using (auth.uid() = user_id);
create policy "insert own rows" on tracked_picks for insert with check (auth.uid() = user_id);
create policy "delete own rows" on tracked_picks for delete using (auth.uid() = user_id);
