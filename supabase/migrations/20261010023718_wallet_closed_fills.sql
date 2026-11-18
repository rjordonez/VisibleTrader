create or replace function public.wallet_closed_fills(
  p_wallet text, p_before_ts timestamptz default null, p_before_id bigint default null)
returns table(condition_id text, outcome text, title text, category text, usd numeric, price numeric,
  ts timestamptz, resolved_win boolean, resolved_ts timestamptz, profit numeric, id bigint)
language sql
stable
security definer
set search_path = public
as $$
  select ow.condition_id, ow.outcome, o.title, o.category, ow.usd, ow.price, ow.ts,
    ow.resolved_win, ow.resolved_ts,
    coalesce(ow.closed_profit, ow.usd / ow.price * coalesce(o.latest_price, ow.price) - ow.usd),
    ow.id
  from (
    select * from opportunity_wallets w
    where w.wallet = p_wallet and w.market_closed
      and (w.resolved_ts, w.id) < (coalesce(p_before_ts, 'infinity'::timestamptz), coalesce(p_before_id, 9223372036854775807))
    order by w.resolved_ts desc, w.id desc
    limit 1000
  ) ow
  left join opportunities o
    on o.condition_id = ow.condition_id and o.outcome = ow.outcome and o.is_current
  where exists (
    select 1 from subscriptions s
    where s.user_id = auth.uid() and s.status = any (array['trialing', 'active'])
  )
  order by ow.resolved_ts desc, ow.id desc;
$$;

revoke all on function public.wallet_closed_fills(text, timestamptz, bigint) from public, anon;
grant execute on function public.wallet_closed_fills(text, timestamptz, bigint) to authenticated;
