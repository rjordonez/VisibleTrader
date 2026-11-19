-- Current trials are distinct from successful post-trial billing.
alter table public.subscriptions add column stripe_livemode boolean;
alter table public.subscriptions add column stripe_trial_started_at timestamptz;
alter table public.subscriptions add column stripe_trial_ends_at timestamptz;
alter table public.subscription_payments add column trial_ended_at timestamptz;
alter table public.subscription_payments add column trial_classification_checked boolean not null default false;

-- Unknown historical classifications return null until Stripe reconciliation;
-- they must never silently appear as a confirmed zero.
create or replace function private.creator_dashboard() returns jsonb
 language plpgsql security definer set search_path='' as $$
declare caller uuid := auth.uid(); account_email text; result jsonb;
begin
 if caller is null then raise exception 'Sign in required' using errcode='42501'; end if;
 select lower(u.email) into account_email from auth.users u where u.id=caller and u.email_confirmed_at is not null;
 if account_email is null or not exists(select 1 from public.creator_dashboard_access where email=account_email) then
  raise exception 'This account does not have creator dashboard access' using errcode='42501';
 end if;
 with allowed as (
  select distinct c.creator from public.creator_dashboard_profiles c
  where exists(select 1 from public.creator_dashboard_access a where a.email=account_email and a.creator in ('*',c.creator))
 ), stats as (
  select a.creator,
   (select display_name from public.creator_dashboard_profiles where creator=a.creator) as display_name,
   (select jsonb_agg(c.code order by case when c.code in ('anthony','vlad','jayden','jc') then 0 else 1 end,length(c.code),c.code) from public.creator_referral_codes c where c.creator=a.creator) as referral_codes,
   case when h.creator is null then null else h.clicks + (select count(*) from public.creator_link_clicks l join public.creator_referral_codes c on c.code=l.referral_code where c.creator=a.creator and l.clicked_at>h.measured_through) end as clicks,
   h.measured_from as clicks_since,
   (select count(*) from public.signup_attributions s join public.creator_referral_codes c on c.code=s.referral_code where c.creator=a.creator) as signups,
   case when exists (
    select 1 from public.subscriptions s join public.signup_attributions sa on sa.user_id=s.user_id join public.creator_referral_codes c on c.code=sa.referral_code
    where c.creator=a.creator and s.status='trialing' and s.stripe_subscription_id is not null and (s.stripe_livemode is null or s.stripe_trial_ends_at is null)
   ) then null else (
    select count(distinct s.user_id) from public.subscriptions s join public.signup_attributions sa on sa.user_id=s.user_id join public.creator_referral_codes c on c.code=sa.referral_code
    where c.creator=a.creator and s.status='trialing' and s.stripe_livemode and s.stripe_trial_ends_at > now()
   ) end as active_trials,
   case when exists (
    select 1 from public.subscription_payments p join public.creator_referral_codes c on c.code=p.referral_code
    where c.creator=a.creator and p.livemode and not p.trial_classification_checked and p.payment_kind <> 'introductory'
   ) then null else (
    select count(distinct p.payer_id) from public.subscription_payments p join public.creator_referral_codes c on c.code=p.referral_code
    where c.creator=a.creator and p.livemode and p.trial_classification_checked and p.billing_reason='subscription_cycle'
      and p.trial_ended_at is not null and p.paid_at >= p.trial_ended_at
   ) end as paid_conversions
  from allowed a left join public.creator_click_history h on h.creator=a.creator
 ) select coalesce(jsonb_agg(to_jsonb(stats) order by creator),'[]'::jsonb) into result from stats;
 return jsonb_build_object('creators',result,'updated_at',now());
end;
$$;
