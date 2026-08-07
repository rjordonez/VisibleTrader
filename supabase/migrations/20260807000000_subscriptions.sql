-- Stripe subscription status per user. Only ever written by the
-- stripe-webhook Edge Function (via the service role key, which bypasses
-- RLS) — a user should never be able to set their own plan/status directly,
-- so there's deliberately no insert/update/delete policy for `authenticated`,
-- only select-your-own-row. One row per user (upserted on conflict).
create table subscriptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade unique,
  stripe_customer_id text,
  stripe_subscription_id text,
  price_id text,
  plan text,
  status text,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table subscriptions enable row level security;
grant select on subscriptions to authenticated;
create policy "own row only" on subscriptions for select using (auth.uid() = user_id);
