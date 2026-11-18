-- Canonical, immutable attribution. Client-editable auth metadata is only a
-- legacy import / signup hint; it is never used to change an existing claim.
create schema if not exists private;
create table public.creator_referral_codes (
  code text primary key,
  creator text not null
);
insert into public.creator_referral_codes (code, creator) values
 ('c8b21c','jcwann'), ('guukq8','toby.bets'), ('qx3ezk','paxx.prints'),
 ('gb6k9u','vladdi.trades'), ('cvxysr','lincolnpredicts'), ('qjyzmf','rextracks'),
 ('qycjpu','rex_predicts'), ('2js266','nate.predicts'), ('eztm6e','rudrapredicts'),
 ('2p348p','dretrdzzz'), ('6dek9j','cha0spredicts'), ('n2u7n5','rykertracks'),
 ('3jpkjm','anthony'), ('anthony','anthony'), ('jc','jcwann'), ('jayden','jayden'),
 ('vlad','vladdi.trades'), ('vladdi.trades','vladdi.trades');
alter table public.creator_referral_codes enable row level security;
revoke all on public.creator_referral_codes from anon, authenticated;
grant all on public.creator_referral_codes to service_role;

create table public.signup_attributions (
  account_id uuid primary key,
  user_id uuid unique references auth.users(id) on delete set null,
  referral_code text references public.creator_referral_codes(code),
  signed_up_at timestamptz not null,
  finalized_at timestamptz,
  source text not null check (source in ('signup_metadata','oauth_callback','direct','legacy','legacy_unknown','pending'))
);
create index signup_attributions_referral_idx on public.signup_attributions(referral_code);
alter table public.signup_attributions enable row level security;
revoke all on public.signup_attributions from anon, authenticated;
grant select on public.signup_attributions to authenticated;
grant all on public.signup_attributions to service_role;
create policy "read own attribution" on public.signup_attributions for select to authenticated
 using ((select auth.uid()) = user_id);

-- Freeze every pre-existing account, even if its referral is unknown. A visit
-- after deployment must never turn an existing customer into a new referral.
insert into public.signup_attributions(account_id, user_id, referral_code, signed_up_at, finalized_at, source)
 select u.id, u.id, c.code, u.created_at, now(), case when c.code is null then 'legacy_unknown' else 'legacy' end
 from auth.users u left join public.creator_referral_codes c on c.code = u.raw_user_meta_data->>'referral_code';

create function private.initialize_signup_attribution() returns trigger
 language plpgsql security definer set search_path = '' as $$
declare code text;
begin
 select c.code into code from public.creator_referral_codes c where c.code = new.raw_user_meta_data->>'referral_code';
 insert into public.signup_attributions(account_id, user_id, referral_code, signed_up_at, finalized_at, source)
 values (new.id, new.id, code, new.created_at, case when code is not null then now() end,
         case when code is not null then 'signup_metadata' else 'pending' end);
 return new;
end;
$$;
revoke all on function private.initialize_signup_attribution() from public, anon, authenticated;
create trigger initialize_signup_attribution after insert on auth.users
 for each row execute function private.initialize_signup_attribution();

-- Narrow privileged operation; callers cannot select another user or rewrite
-- a finalized referral. Concurrent requests serialize on the user's row.
create function private.capture_signup_referral(p_code text) returns void
 language plpgsql security definer set search_path = '' as $$
declare caller uuid := auth.uid(); code text;
begin
 if caller is null then raise exception 'Authentication required' using errcode = '42501'; end if;
 select c.code into code from public.creator_referral_codes c where c.code = p_code;
 update public.signup_attributions set referral_code = code, finalized_at = now(),
   source = case when code is null then 'direct' else 'oauth_callback' end
 where user_id = caller and finalized_at is null;
 if not exists (select 1 from public.signup_attributions where user_id = caller) then
   raise exception 'Missing signup attribution';
 end if;
end;
$$;
revoke all on function private.capture_signup_referral(text) from public, anon, authenticated;
grant usage on schema private to authenticated;
grant execute on function private.capture_signup_referral(text) to authenticated;
create function public.capture_signup_referral(p_code text default null) returns void
 language sql security invoker set search_path = '' as $$
 select private.capture_signup_referral(p_code);
$$;
revoke all on function public.capture_signup_referral(text) from public, anon;
grant execute on function public.capture_signup_referral(text) to authenticated;

-- One immutable row per paid invoice, not per webhook delivery. Kept separately
-- from current access status so cancellation and resubscription lose no history.
create table public.subscription_payments (
  stripe_invoice_id text primary key,
  referral_code text references public.creator_referral_codes(code),
  user_id uuid references auth.users(id) on delete set null,
  payer_id uuid not null,
  stripe_customer_id text not null,
  stripe_subscription_id text not null,
  amount_paid bigint not null check (amount_paid > 0),
  currency text not null,
  paid_at timestamptz not null,
  billing_reason text,
  payment_kind text not null check (payment_kind in ('introductory','initial','renewal','adjustment')),
  livemode boolean not null,
  recorded_at timestamptz not null default now()
);
create index subscription_payments_user_paid_idx on public.subscription_payments(user_id, paid_at);
alter table public.subscription_payments enable row level security;
revoke all on public.subscription_payments from anon, authenticated;
grant all on public.subscription_payments to service_role;

-- Snapshot creator credit before insertion so deleting an account does not
-- erase the creator's historical paid conversions. Clients cannot write here.
create function private.snapshot_payment_referral() returns trigger
 language plpgsql security definer set search_path = '' as $$
begin
 new.payer_id := new.user_id;
 select a.referral_code into new.referral_code from public.signup_attributions a where a.user_id = new.user_id;
 return new;
end;
$$;
revoke all on function private.initialize_signup_attribution(), private.snapshot_payment_referral() from public, anon, authenticated;
create trigger snapshot_payment_referral before insert on public.subscription_payments
 for each row execute function private.snapshot_payment_referral();


-- Operational report, service-role only. Unknown attribution is explicit.
-- Count every payer once; revenue stays in integer minor units by currency.
create view public.creator_referral_signups with (security_invoker = true) as
 select c.creator, count(*) as signups,
 count(*) filter (where a.finalized_at is null) as pending_attribution,
 count(*) filter (where a.source = 'legacy_unknown') as legacy_unknown
 from public.signup_attributions a left join public.creator_referral_codes c on c.code = a.referral_code
 group by c.creator;
create view public.creator_referral_payments with (security_invoker = true) as
 select c.creator, p.currency, count(distinct p.payer_id) as paying_customers,
 count(distinct p.payer_id) filter (where p.payment_kind <> 'introductory') as non_intro_paying_customers,
 count(*) as paid_invoices,
 count(*) filter (where p.payment_kind = 'renewal') as renewal_invoices,
 sum(p.amount_paid) as gross_paid_minor_units
 from public.subscription_payments p
 left join public.creator_referral_codes c on c.code = p.referral_code
 where p.livemode
 group by c.creator, p.currency;
revoke all on public.creator_referral_signups, public.creator_referral_payments from anon, authenticated;
grant select on public.creator_referral_signups, public.creator_referral_payments to service_role;
