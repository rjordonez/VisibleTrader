-- Filter before sorting/pagination without changing historical market views.
create or replace view public.expert_picks_open with (security_invoker = true) as
select * from public.opportunities_live
where entries > exited + closed
  and latest_price > 0 and latest_price < 1;
grant select on public.expert_picks_open to authenticated;
