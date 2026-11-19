-- Second billing provider (Whop) for a share of NEW checkouts. Additive only:
-- every existing row is a Stripe row, so `provider` defaults to 'stripe' and
-- no Stripe code path changes meaning. `subscriptions` stays the single source
-- of truth for access; whop-webhook writes Whop state into the same columns
-- (status/current_period_end) that ProtectedRoute already reads.

alter table public.subscriptions
  add column provider text not null default 'stripe' check (provider in ('stripe', 'whop')),
  add column whop_membership_id text unique,
  add column whop_member_id text,
  add column whop_user_id text,
  add column whop_manage_url text,
  add column cancel_at_period_end boolean,
  add column whop_updated_at timestamptz;

-- Whop payments reuse the existing columns so creator payout views keep
-- working unchanged: stripe_invoice_id holds the Whop payment id (pay_...),
-- stripe_subscription_id the membership id (mem_...), stripe_customer_id the
-- Whop member id. `provider` says which is which.
alter table public.subscription_payments
  add column provider text not null default 'stripe' check (provider in ('stripe', 'whop'));

-- Which provider a user was assigned on their first checkout attempt, so a
-- user who reopens checkout always lands on the same provider.
create table public.checkout_assignments (
  user_id uuid primary key references auth.users(id) on delete cascade,
  provider text not null check (provider in ('stripe', 'whop')),
  split_percent integer not null,
  assigned_at timestamptz not null default now()
);
alter table public.checkout_assignments enable row level security;
revoke all on public.checkout_assignments from anon, authenticated;
grant all on public.checkout_assignments to service_role;

-- Webhook deliveries already processed (Whop delivers at least once and
-- reuses webhook-id on retries).
create table public.whop_webhook_events (
  webhook_id text primary key,
  event_type text,
  received_at timestamptz not null default now()
);
alter table public.whop_webhook_events enable row level security;
revoke all on public.whop_webhook_events from anon, authenticated;
grant all on public.whop_webhook_events to service_role;
