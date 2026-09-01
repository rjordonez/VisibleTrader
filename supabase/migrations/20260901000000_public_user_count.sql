-- Public "how many users do we have" stat (e.g. a landing-page "join N
-- traders" line) — security definer so it can count auth.users (not
-- otherwise readable by anon/authenticated) while only ever returning a
-- count, never any user data. Same access-control shape as
-- has_active_subscription() (20260808000000_gate_product_data_by_subscription.sql).
-- PostgREST auto-exposes this as a real public REST endpoint:
--   POST {SUPABASE_URL}/rest/v1/rpc/public_user_count
--   headers: apikey: <anon key>
create or replace function public_user_count()
returns bigint
language sql
security definer
stable
as $$
  select count(*) from auth.users
$$;
grant execute on function public_user_count() to anon, authenticated;
