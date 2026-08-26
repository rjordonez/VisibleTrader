-- Adds a unified closed_at column to wallet_positions — a position closes
-- one of two mutually-exclusive ways (a manual/scalp sell sets exit_ts, or
-- the market resolving while still held sets resolved_ts), and there was
-- no single column to sort/filter "when did this close" across both paths.
-- Purely additive (one new trailing column) — every existing consumer
-- (ProfitsPage.tsx's `.eq('market_closed', true)` query) is unaffected.
create or replace view wallet_positions with (security_invoker = true) as
  select ow.condition_id, ow.outcome, ow.wallet, ow.wallet_name, o.title, o.category,
    ow.usd, ow.price, ow.ts, ow.exit_ts, ow.exit_price, ow.exit_usd, ow.hold_seconds,
    ow.is_scalp, ow.market_closed, ow.resolved_win, ow.resolved_ts,
    case
      when ow.market_closed = true then
        case when ow.resolved_win = true then (ow.usd / ow.price) - ow.usd else -ow.usd end
      when ow.exit_ts is not null and ow.exit_price is not null then
        (ow.usd / ow.price) * ow.exit_price - ow.usd
      else
        (ow.usd / ow.price) * coalesce(o.latest_price, ow.price) - ow.usd
    end as profit,
    coalesce(ow.resolved_ts, ow.exit_ts) as closed_at
  from opportunity_wallets ow
  join opportunities o on o.condition_id = ow.condition_id and o.outcome = ow.outcome and o.is_current = true;
