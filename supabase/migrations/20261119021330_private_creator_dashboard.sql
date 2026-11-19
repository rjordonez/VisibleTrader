create table public.creator_dashboard_profiles (creator text primary key,display_name text not null);
alter table public.creator_dashboard_profiles enable row level security;
revoke all on public.creator_dashboard_profiles from public,anon,authenticated;
grant all on public.creator_dashboard_profiles to service_role;
insert into public.creator_dashboard_profiles(creator,display_name) values
('alex-eleas','Alex Eleas'),
('mateo-p','Mateo P'),
('vladdi.trades','Vlad'),
('frankie-bryant','Frankie Bryant'),
('eric-kim','Eric Kim'),
('jayden','Jayden Haynes'),
('jacob-hiller','Jacob hiller'),
('ismael-santiago','Ismael Santiago'),
('akram-mohamed','Akram Mohamed'),
('aryan-misra','Aryan Misra'),
('anthony','Anthony Babin'),
('dana-figueroa','Dana Figueroa'),
('lucas-spillner','Lucas Spillner'),
('toby.bets','Tavasya Ganpati'),
('paxx.prints','Rami Haddad'),
('diego-gutierrez','Diego Gutierrez'),
('ian-tapia','Ian Tapia'),
('durand-dyer','Durand Dyer'),
('peyton-mitchell','Peyton Mitchell'),
('brian-dede','Brian Dede'),
('alberto-vasquez','Alberto Vasquez');
insert into public.creator_referral_codes(code,creator) values
('alex-eleas','alex-eleas'),
('mateo-p','mateo-p'),
('frankie-bryant','frankie-bryant'),
('eric-kim','eric-kim'),
('jacob-hiller','jacob-hiller'),
('ismael-santiago','ismael-santiago'),
('akram-mohamed','akram-mohamed'),
('aryan-misra','aryan-misra'),
('dana-figueroa','dana-figueroa'),
('lucas-spillner','lucas-spillner'),
('diego-gutierrez','diego-gutierrez'),
('ian-tapia','ian-tapia'),
('durand-dyer','durand-dyer'),
('peyton-mitchell','peyton-mitchell'),
('brian-dede','brian-dede'),
('alberto-vasquez','alberto-vasquez') on conflict(code) do nothing;

-- Owner-approved emails only; each creator is scoped separately.
create table public.creator_dashboard_access (
 email text not null check (email = lower(trim(email))),
 creator text not null,
 created_at timestamptz not null default now(),
 primary key(email, creator)
);
-- '*' explicitly grants the owner all creators. Other values are creator handles.
alter table public.creator_dashboard_access enable row level security;
revoke all on public.creator_dashboard_access from public, anon, authenticated;
grant all on public.creator_dashboard_access to service_role;

create table public.creator_click_history (
 creator text primary key,
 clicks bigint not null check(clicks >= 0),
 measured_from timestamptz not null,
 measured_through timestamptz not null check(measured_through >= measured_from)
);
alter table public.creator_click_history enable row level security;
revoke all on public.creator_click_history from public, anon, authenticated;
grant all on public.creator_click_history to service_role;

-- New links have no earlier history; legacy links are imported separately.
insert into public.creator_click_history(creator,clicks,measured_from,measured_through)
 select creator,0,now(),now() from public.creator_dashboard_profiles
 where creator not in ('anthony','toby.bets','paxx.prints','jayden','vladdi.trades');

create table public.creator_link_clicks (
 event_id uuid primary key,
 referral_code text not null references public.creator_referral_codes(code),
 network_hash text not null,
 clicked_at timestamptz not null default now()
);
create index creator_link_clicks_code_time on public.creator_link_clicks(referral_code,clicked_at);
create index creator_link_clicks_network_time on public.creator_link_clicks(network_hash,clicked_at);
alter table public.creator_link_clicks enable row level security;
revoke all on public.creator_link_clicks from public, anon, authenticated;
grant all on public.creator_link_clicks to service_role;

-- Only the authenticated server function can ingest clicks. Serializing by
-- network makes the modest 30/minute abuse cap atomic across concurrent calls.
create function public.record_creator_link_click(p_event_id uuid,p_code text,p_network_hash text)
 returns boolean language plpgsql security invoker set search_path='' as $$
begin
 if length(p_network_hash) <> 64 then return false; end if;
 if not exists(select 1 from public.creator_referral_codes where code=p_code) then return false; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_network_hash,0));
 if (select count(*) from public.creator_link_clicks where network_hash=p_network_hash and clicked_at > now()-interval '1 minute') >= 30 then return false; end if;
 insert into public.creator_link_clicks(event_id,referral_code,network_hash) values(p_event_id,p_code,p_network_hash) on conflict(event_id) do nothing;
 return true;
end;
$$;
revoke all on function public.record_creator_link_click(uuid,text,text) from public,anon,authenticated;
grant execute on function public.record_creator_link_click(uuid,text,text) to service_role;

-- Read the verified account email from auth.users, never user-editable metadata
-- or a creator/email supplied by the browser. Check the allowlist on every call.
create function private.creator_dashboard() returns jsonb
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
   (select count(distinct p.payer_id) from public.subscription_payments p join public.creator_referral_codes c on c.code=p.referral_code where c.creator=a.creator and p.livemode) as paid_subscribers,
   (select count(distinct p.payer_id) from public.subscription_payments p join public.creator_referral_codes c on c.code=p.referral_code where c.creator=a.creator and p.livemode and p.payment_kind<>'introductory') as regular_paying_subscribers
  from allowed a left join public.creator_click_history h on h.creator=a.creator
 ) select coalesce(jsonb_agg(to_jsonb(stats) order by creator),'[]'::jsonb) into result from stats;
 return jsonb_build_object('creators',result,'updated_at',now());
end;
$$;
revoke all on function private.creator_dashboard() from public,anon;
grant execute on function private.creator_dashboard() to authenticated;
create function public.creator_dashboard() returns jsonb language sql security invoker set search_path='' as $$ select private.creator_dashboard(); $$;
revoke all on function public.creator_dashboard() from public,anon;
grant execute on function public.creator_dashboard() to authenticated;

insert into public.creator_dashboard_access(email,creator) values
 ('tavasyag@gmail.com','*'),('tavasya@visibletrader.com','*'),
 ('visibletraderhq@gmail.com','*'),('rex@visibletrader.com','*');
