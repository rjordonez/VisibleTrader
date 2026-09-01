-- wallet_positions' profit/closed_at were computed live via a CASE
-- expression joining opportunity_wallets to opportunities on every read.
-- TraderDetailPage's per-wallet queries are cheap enough for this (fixed
-- by the ilike->eq + composite index in the previous migration), but the
-- Winners feed (SignalsDemo.tsx) queries with NO wallet filter at all --
-- "most recent 200 profitable closed positions across every wallet" --
-- meaning every read scanned/computed this expression over the entire
-- (969k+ row and growing) table. Reported live as wallet_positions
-- returning a 500 (matches this codebase's own documented failure mode:
-- PostgREST's 8s statement_timeout under real session/RLS overhead, see
-- 20260817010000_precompute_opportunity_aggregates.sql).
--
-- Postgres can't build a useful index on a view's CASE expression, so this
-- adds real generated (stored, auto-maintained) columns on the base table
-- for the CLOSED-position case specifically -- the only case the Winners
-- feed ever queries (it always filters closed_at is not null first). The
-- still-open case still needs opportunities.latest_price (a different
-- table), which a generated column can't reference, so it stays a live
-- fallback in the view -- but that path is never hit by the Winners feed.
alter table opportunity_wallets
  add column closed_at timestamptz generated always as (coalesce(resolved_ts, exit_ts)) stored,
  add column closed_profit numeric generated always as (
    case
      when market_closed = true then
        case when resolved_win = true then (usd / price) - usd else -usd end
      when exit_ts is not null and exit_price is not null then
        (usd / price) * exit_price - usd
      else null
    end
  ) stored;

-- Matches the Winners feed's actual filter+sort exactly: closed, profitable
-- positions ordered by when they closed.
create index opportunity_wallets_closed_profit_idx on opportunity_wallets (closed_at desc) where closed_profit > 0;

-- closed_profit is exposed alongside the general-purpose profit column
-- (rather than having callers filter profit > 0 through the coalesce)
-- specifically so a caller querying closed positions only -- the Winners
-- feed -- can filter/sort on real generated columns directly, guaranteeing
-- the partial index above gets used instead of hoping the planner proves
-- profit > 0 implies closed_profit > 0 through the coalesce.
create or replace view wallet_positions with (security_invoker = true) as
  select ow.condition_id, ow.outcome, ow.wallet, ow.wallet_name, o.title, o.category,
    ow.usd, ow.price, ow.ts, ow.exit_ts, ow.exit_price, ow.exit_usd, ow.hold_seconds,
    ow.is_scalp, ow.market_closed, ow.resolved_win, ow.resolved_ts,
    coalesce(ow.closed_profit, (ow.usd / ow.price) * coalesce(o.latest_price, ow.price) - ow.usd) as profit,
    ow.closed_at, ow.closed_profit
  from opportunity_wallets ow
  join opportunities o on o.condition_id = ow.condition_id and o.outcome = ow.outcome and o.is_current = true;
