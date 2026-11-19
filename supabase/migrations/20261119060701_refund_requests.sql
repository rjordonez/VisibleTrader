-- Refund requests submitted from the in-app refund page. Gives each request
-- a customer-facing reference, lets the function reuse a request made in the
-- last 24 hours instead of emailing twice, and keeps a record for support.
create table public.refund_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  user_id uuid references auth.users(id) on delete set null,
  provider text not null check (provider in ('stripe', 'whop')),
  charge_ref text not null,
  amount_cents bigint not null,
  currency text not null,
  category text not null,
  details text not null default '',
  status text not null default 'open' check (status in ('open', 'approved', 'denied')),
  created_at timestamptz not null default now()
);
create index refund_requests_user_created_idx on public.refund_requests(user_id, created_at desc);
alter table public.refund_requests enable row level security;
revoke all on public.refund_requests from anon, authenticated;
grant all on public.refund_requests to service_role;
