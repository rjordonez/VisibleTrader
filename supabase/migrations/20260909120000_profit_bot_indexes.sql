-- The profit_bot_* RPCs were scanning every opportunity_wallets row for each
-- proven wallet (~5k rows, filtered down to ~430) and spilling a sort to
-- disk, ~2.3s warm and blowing the PostgREST statement timeout under load
-- (intermittent 500s on the Profits page). These partial indexes match the
-- RPC WHERE clauses so each per-wallet lookup is an index scan of ~430
-- rows: profit_bot_picks() ~8ms, the others ~170-300ms.
create index if not exists opportunity_wallets_pbot_resolved_idx
  on opportunity_wallets (wallet, condition_id, outcome, resolved_win, price)
  where resolved_ts is not null and closed_profit is not null
    and price >= 0.40 and price <= 0.80 and usd >= 100;

create index if not exists opportunity_wallets_pbot_open_idx
  on opportunity_wallets (wallet, condition_id, outcome)
  where resolved_ts is null and exit_ts is null
    and price >= 0.40 and price <= 0.80 and usd >= 100;
