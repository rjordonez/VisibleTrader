-- refresh_profit_bot_cache() was the single largest disk I/O consumer in
-- the project per pg_stat_statements: called every ~2 min
-- (PROFIT_BOT_REFRESH_SECONDS) and, unlike refresh_leaderboard /
-- refresh_opportunity_aggregates / refresh_wallet_category_breakdown, it
-- still did a full GROUP BY over opportunity_wallets JOIN proven_wallets on
-- every call instead of being bounded by what actually changed. Same fix as
-- opportunity_aggregate_dirty: track which (condition_id, outcome) pairs
-- have new contributions, a changed contributing wallet's balance, or a
-- changed contributing wallet's win rate, and only recompute those pairs'
-- profit-bot aggregates each pass. See refresh_profit_bot in
-- scripts/live-signal-service.py for the consumer and reconcile_caches for
-- the full-recompute correction pass (still calls
-- refresh_profit_bot_cache() below, unchanged, at a much lower cadence).
create table if not exists profit_bot_dirty (
  condition_id text not null,
  outcome      text not null,
  primary key (condition_id, outcome)
);

-- Seed with every pair that already has contributions so the incremental
-- path has useful work queued immediately instead of starting empty and
-- relying solely on the hourly reconcile pass to populate profit-bot data
-- for pre-existing markets. Drains over time via refresh_profit_bot's
-- capped per-cycle batch, same as opportunity_aggregate_dirty's backlog.
insert into profit_bot_dirty (condition_id, outcome)
select distinct condition_id, outcome from opportunity_contributors
on conflict do nothing;

-- opportunity_wallets_condition_outcome_idx (condition_id, outcome) is a
-- strict prefix of opportunity_wallets_co_wallet_idx (condition_id,
-- outcome, wallet) — any query that could use the former is served just as
-- well by the latter. Every insert/update to this table (the hottest table
-- in the project) was maintaining both for no benefit.
drop index if exists opportunity_wallets_condition_outcome_idx;
