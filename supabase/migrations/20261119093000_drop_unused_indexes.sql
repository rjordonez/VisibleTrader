-- supabase-no-transaction
--
-- Drop four indexes that were unused over a 76-day pg_stat_user_indexes window
-- (and flagged by the database linter), to reclaim disk and cut write
-- amplification on the hot opportunity_wallets table. Freed ~471MB on
-- production (9036MB -> 8565MB). Applied directly to production via
-- CONCURRENTLY; IF EXISTS + no-transaction so it's safe to replay.
--
--   opportunity_wallets_ts_idx          320MB  1,251 scans / 76d
--   wallet_directory_username_trgm_idx   81MB      1 scan  / 76d
--   wallet_directory_best_pnl_idx        42MB      6 scans / 76d
--   idx_wallet_directory_recent_pnl      27MB      0 scans / 76d
--
-- The wallet-leading opportunity_wallets_pbot_resolved_idx / _pbot_open_idx
-- are intentionally kept — still heavily used (5.5M / 10.5M scans) for
-- per-wallet lookups, distinct from the (condition_id, outcome)-keyed
-- *_co_idx added for the profit-bot dirty-pair refresh.

DROP INDEX CONCURRENTLY IF EXISTS public.opportunity_wallets_ts_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.wallet_directory_username_trgm_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.wallet_directory_best_pnl_idx;
DROP INDEX CONCURRENTLY IF EXISTS public.idx_wallet_directory_recent_pnl;
