-- "Has open positions" on the Leaderboard. Counting open positions live per
-- page view took 3s for the Experts/Insiders wallets and 8-16s for the
-- top-P&L bots (tens of thousands of open fills each), on every load, for
-- every viewer. Instead live-signal-service.py refreshes the count every
-- TRADER_OPEN_REFRESH_SECONDS (10 min, ~15-20s per pass) for just the wallets the Leaderboard can show
-- (experts, insiders, top 100 by P&L) and the page reads two stored columns.
--
-- The partial index is keyed by wallet so that refresh is an index scan over
-- only those wallets' open fills. Same predicate as
-- opportunity_wallets_open_positions_idx. Built CONCURRENTLY on prod
-- (outside a transaction) so it never locked the live table; rerunning this
-- file is a no-op once it exists.
create index concurrently if not exists opportunity_wallets_open_wallet_idx
  on opportunity_wallets (wallet) include (condition_id, outcome, usd)
  where exit_ts is null and (market_closed is null or market_closed = false);

alter table trader_scores
  add column if not exists open_positions integer not null default 0,
  add column if not exists open_usd numeric not null default 0;

create or replace function public.refresh_trader_open_positions()
returns integer
language plpgsql
as $function$
declare
  v_wallets text[];
  v_rows integer;
begin
  select array_agg(wallet) into v_wallets from (
    select wallet from trader_scores where is_expert or is_insider
    union
    (select wallet from trader_scores order by pnl desc limit 100)
  ) w;

  update trader_scores t set
    open_positions = coalesce(o.positions, 0),
    open_usd = coalesce(o.usd, 0)
  from unnest(v_wallets) as w(wallet)
  left join (
    -- Fold fills to positions first (index scan over just these wallets),
    -- then keep only markets still trading: a position whose market already
    -- sits at 0/100% but hasn't been swept closed yet isn't live.
    select p.wallet, count(*)::int as positions, sum(p.usd) as usd
    from (
      select ow.wallet, ow.condition_id, ow.outcome, sum(ow.usd) as usd
      from opportunity_wallets ow
      where ow.wallet = any(v_wallets)
        and ow.exit_ts is null and (ow.market_closed is null or ow.market_closed = false)
      group by 1, 2, 3
    ) p
    join opportunities op on op.condition_id = p.condition_id and op.outcome = p.outcome and op.is_current
    where op.latest_price > 0.02 and op.latest_price < 0.98
    group by p.wallet
  ) o on o.wallet = w.wallet
  where t.wallet = w.wallet;
  get diagnostics v_rows = row_count;

  -- A wallet that drops off every list keeps a stale count otherwise.
  update trader_scores set open_positions = 0, open_usd = 0
  where open_positions > 0 and wallet <> all(v_wallets);
  return v_rows;
end;
$function$;

select refresh_trader_open_positions();
