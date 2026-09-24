-- Emergency fix, applied directly to production first (2026-09-22 ~04:38
-- UTC) then backfilled into migration history here — see incident notes
-- below.
--
-- main()'s startup rehydration query
-- (SELECT DISTINCT condition_id, outcome FROM opportunity_wallets WHERE
-- market_closed = true, scripts/live-signal-service.py's main()) had no
-- covering index and had grown, with table size (3.4M+ rows), to
-- consistently exceed the 2-minute statement_timeout — causing
-- live-signal-service to crash on every startup attempt (an unhandled
-- exception in main(), outside any try/except, killing the whole process)
-- and loop via systemd's auto-restart with no working window in between,
-- since the crash happens before the main trading loop is ever reached.
-- This was pre-existing, unrelated to any same-day code changes, and
-- happened to be triggered by a routine deploy restarting the process.
--
-- Confirmed via EXPLAIN ANALYZE against production: this index dropped
-- the query from >2min (timeout) to ~6.4s (Index Only Scan).
CREATE INDEX CONCURRENTLY IF NOT EXISTS opportunity_wallets_market_closed_co_idx
  ON opportunity_wallets (condition_id, outcome)
  WHERE market_closed = true;
