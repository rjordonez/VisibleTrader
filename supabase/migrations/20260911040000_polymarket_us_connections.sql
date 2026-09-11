-- Polymarket US account connections. Unlike polymarket_connections (a wallet
-- signature that proves control at one point in time and is never stored),
-- a US API Secret Key is a reusable bearer credential that has to be kept
-- around to sync on the user's behalf. It is never stored in plaintext:
-- the edge function sends it to an isolated Cloud Run service
-- (polymarket-us-kms-proxy) that encrypts/decrypts it via Cloud KMS. Only
-- that service's dedicated GCP service account can perform the KMS
-- operation; this table only ever holds the resulting ciphertext.
create table public.polymarket_us_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  key_id text not null,
  ciphertext text not null,
  kms_key_version text not null,
  status text not null default 'active' check (status in ('active', 'needs_reconnect', 'revoked')),
  last_verified_at timestamptz,
  last_synced_at timestamptz,
  connected_at timestamptz not null default now()
);
alter table public.polymarket_us_connections enable row level security;
revoke all on public.polymarket_us_connections from anon, authenticated;
grant select, delete on public.polymarket_us_connections to authenticated;
grant all on public.polymarket_us_connections to service_role;
create policy "Read own Polymarket US connection" on public.polymarket_us_connections
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Remove own Polymarket US connection" on public.polymarket_us_connections
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Audit trail for credential lifecycle events. Never logs key material,
-- only that something happened. Service-role only, same as the challenges
-- table for the international flow.
create table public.polymarket_us_connection_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null check (event in ('connected', 'replaced', 'verify_failed', 'disconnected')),
  created_at timestamptz not null default now()
);
alter table public.polymarket_us_connection_events enable row level security;
revoke all on public.polymarket_us_connection_events from anon, authenticated;
grant all on public.polymarket_us_connection_events to service_role;
