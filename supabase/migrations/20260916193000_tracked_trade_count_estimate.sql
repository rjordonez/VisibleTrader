-- tracked_trade_count() backs a cosmetic landing-page counter, always
-- called pre-login (anon role, 3s statement_timeout). An exact COUNT(*)
-- over opportunity_wallets (2.6M+ rows) takes 2s+ even with zero
-- contention, which is close enough to that timeout that ordinary jitter
-- (a concurrent request, routine autovacuum) tips it into a 500. The
-- landing page doesn't need an exact number, so use Postgres's own
-- planner row-estimate (refreshed by autovacuum/analyze) instead — this
-- returns in milliseconds regardless of table size.
create or replace function public.tracked_trade_count()
returns bigint
language sql
security definer
set search_path = public
as $$
  select reltuples::bigint from pg_class where oid = 'public.opportunity_wallets'::regclass;
$$;

grant execute on function public.tracked_trade_count() to anon, authenticated;
