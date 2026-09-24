-- Every resolved pick's pnl in order, for the compounding chart on the
-- Profits page. profit_bot_resolved() is capped at 60 rows for the list, which
-- made the compounding curve start from the 330th pick instead of the first.
-- Only pnl + timestamp (no titles), and the cache table is already public-read.
create or replace function public.profit_bot_resolved_curve()
returns table(pnl numeric, resolved_ts timestamptz)
language sql
stable
as $$
  select pnl, resolved_ts
  from profit_bot_resolved_cache
  order by resolved_ts;
$$;

grant execute on function public.profit_bot_resolved_curve() to anon, authenticated;
