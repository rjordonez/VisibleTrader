-- wallet_positions with security_invoker=true relies on RLS on the
-- underlying opportunity_wallets table for gating -- but Postgres treats
-- RLS-protected relations as "security barrier" views, which restricts how
-- freely the planner can reorder joins against them. Confirmed live: under
-- RLS the planner abandons the new closed_profit index entirely and drives
-- the join from a 47k-row seq scan on opportunities instead, taking 3.3s+
-- (reported live as a full 500 -- PostgREST's 8s statement_timeout,
-- error 57014) vs 84ms with RLS out of the picture. Same query, same data,
-- same index -- RLS's security-barrier semantics were the entire gap.
--
-- Fix: gate access with the same inline EXISTS check every other RLS
-- policy in this codebase already uses (see 20260809000000_fix_rls_-
-- performance_timeout.sql, which hit this exact class of problem once
-- before: has_active_subscription() being security definer made Postgres
-- treat it as an opaque boundary the planner can't optimize through, and
-- was dropped entirely in favor of inlining -- so it doesn't exist to call
-- here either). Evaluated explicitly in the view's own WHERE clause instead
-- of inherited via RLS on the joined table. Dropping security_invoker means
-- this runs as the view owner (bypassing the underlying tables' RLS,
-- confirmed safe since opportunity_wallets doesn't have FORCE ROW LEVEL
-- SECURITY set) so the planner is free to choose the fast join order again.
create or replace view wallet_positions as
  select ow.condition_id, ow.outcome, ow.wallet, ow.wallet_name, o.title, o.category,
    ow.usd, ow.price, ow.ts, ow.exit_ts, ow.exit_price, ow.exit_usd, ow.hold_seconds,
    ow.is_scalp, ow.market_closed, ow.resolved_win, ow.resolved_ts,
    coalesce(ow.closed_profit, (ow.usd / ow.price) * coalesce(o.latest_price, ow.price) - ow.usd) as profit,
    ow.closed_at, ow.closed_profit
  from opportunity_wallets ow
  join opportunities o on o.condition_id = ow.condition_id and o.outcome = ow.outcome and o.is_current = true
  where exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'));
