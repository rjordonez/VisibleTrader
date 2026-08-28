-- A single safe-to-expose aggregate for the landing page's live trade
-- counter. opportunity_wallets itself is paywalled behind an active
-- subscription (its "public read" policy, despite the name, only allows
-- trialing/active subscribers via auth.uid()), so the landing page —
-- always pre-login — can't query it directly, and shouldn't: real
-- trade-level data staying behind the paywall is intentional.
-- SECURITY DEFINER runs as the function owner (bypassing RLS) but this
-- only ever returns a single COUNT, never any row or column data, so it
-- can't be used to leak real trade details the way a relaxed table policy
-- could.
create or replace function public.tracked_trade_count()
returns bigint
language sql
security definer
set search_path = public
as $$
  select count(*) from opportunity_wallets;
$$;

grant execute on function public.tracked_trade_count() to anon, authenticated;
