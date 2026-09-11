-- Public account metadata only. Wallet signatures are verified by the edge
-- function; clients cannot write verified ownership or store trading secrets.
create table public.polymarket_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  signer_address text check (signer_address ~ '^0x[0-9a-f]{40}$'),
  display_name text not null,
  verified_at timestamptz,
  connected_at timestamptz not null default now(),
  check ((verified_at is null) = (signer_address is null))
);

alter table public.polymarket_connections enable row level security;
revoke all on public.polymarket_connections from anon, authenticated;
grant select, delete on public.polymarket_connections to authenticated;
grant all on public.polymarket_connections to service_role;
create policy "Read own Polymarket connection" on public.polymarket_connections
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Remove own Polymarket connection" on public.polymarket_connections
  for delete to authenticated using ((select auth.uid()) = user_id);

-- One short-lived, single-use challenge per signed-in user. Never browser-readable.
create table public.polymarket_connection_challenges (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nonce uuid not null,
  signer_address text not null check (signer_address ~ '^0x[0-9a-f]{40}$'),
  message text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.polymarket_connection_challenges enable row level security;
revoke all on public.polymarket_connection_challenges from anon, authenticated;
grant all on public.polymarket_connection_challenges to service_role;
