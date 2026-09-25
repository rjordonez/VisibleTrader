-- Self-serve comp access: a code that grants product access without a
-- Stripe subscription behind it, redeemable by a user who's already signed
-- up (via OAuth) but whose email we don't know ahead of time — e.g. handing
-- a code to a UGC creator instead of running scripts/grant_pro_access.py
-- per-email after the fact. Generalizes that script's pattern
-- (status='active' with no stripe_customer_id) into something a user can
-- redeem themselves.
create table access_codes (
  id bigint generated always as identity primary key,
  code text not null unique,
  note text,
  max_uses integer not null default 1,
  uses integer not null default 0,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
alter table access_codes enable row level security;
-- No select/insert/update policy for `authenticated` — codes are only ever
-- looked up and incremented inside redeem_access_code (security definer),
-- never read directly via the REST API, so a signed-in user can't enumerate
-- or reuse codes beyond max_uses by going around the function.

-- security definer so it can read/update access_codes (RLS-locked above)
-- and write the caller's own subscriptions row despite that table also
-- having no insert/update policy for `authenticated` (see
-- 20260807000000_subscriptions.sql) — safe because the row it writes is
-- hardcoded to auth.uid(), same reasoning as has_active_subscription().
create or replace function redeem_access_code(code_input text)
returns boolean
language plpgsql
security definer
as $$
declare
  matched access_codes;
begin
  if auth.uid() is null then
    return false;
  end if;

  select * into matched from access_codes
    where code = code_input
      and uses < max_uses
      and (expires_at is null or expires_at > now())
    for update;

  if not found then
    return false;
  end if;

  update access_codes set uses = uses + 1 where id = matched.id;

  -- plan='pro', far-future current_period_end — same shape
  -- scripts/grant_pro_access.py already writes by hand, so it reads
  -- identically everywhere plan/status is displayed or checked.
  insert into subscriptions (user_id, plan, status, current_period_end)
  values (auth.uid(), 'pro', 'active', '2099-12-31T00:00:00Z')
  on conflict (user_id) do update set
    plan = 'pro', status = 'active', current_period_end = '2099-12-31T00:00:00Z', updated_at = now();

  return true;
end;
$$;

grant execute on function redeem_access_code(text) to authenticated;
