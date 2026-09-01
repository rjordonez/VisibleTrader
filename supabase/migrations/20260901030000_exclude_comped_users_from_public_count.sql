-- public_user_count() counted every signed-up account, including accounts
-- manually granted Pro access without ever going through Stripe (see
-- scripts/grant_pro_access.py) -- those inflate a public "join N traders"
-- stat with accounts that aren't real organic signups. Excluding by
-- stripe_customer_id IS NULL (a comped subscription has no real Stripe
-- record behind it, see grant_pro_access.py) rather than an email list, so
-- a *real* future Pro subscriber (via actual Stripe checkout) still counts
-- normally -- only currently-comped accounts are excluded, not "Pro users"
-- as a category.
create or replace function public_user_count()
returns bigint
language sql
security definer
stable
as $$
  select count(*) from auth.users u
  where not exists (
    select 1 from subscriptions s
    where s.user_id = u.id
      and s.status in ('trialing', 'active')
      and s.stripe_customer_id is null
  )
$$;
