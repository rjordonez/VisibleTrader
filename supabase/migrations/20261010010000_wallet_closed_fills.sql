-- Trader profile paged closed fills out of wallet_positions with
-- offset/limit. Every page re-read, joined and disk-sorted the wallet's
-- whole history, so a heavy wallet (72,901 fills) took ~14s per page past
-- offset ~17k and hit the 8s authenticated statement_timeout (500).
--
-- Keyset page instead: the next 1000 fills older than (p_before_ts,
-- p_before_id), newest first, straight off
-- opportunity_wallets_wallet_resolved_idx (~10ms at any depth). The limit is
-- applied before the title join on purpose; joining first let the planner
-- pick a bitmap scan + sort over everything older than the cursor (~5s).
-- Left join so the page always advances 1000 raw fills: the client drops
-- rows with no current opportunity (title null), matching wallet_positions'
-- inner join, and still uses the last raw row as the next cursor.
--
-- Same columns/profit expression and paid-subscriber gate as
-- wallet_positions (20260901020000_wallet_positions_drop_security_invoker).
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
