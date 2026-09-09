-- opportunity_wallets was added to the supabase_realtime publication by
-- 20260802010000_enable_realtime.sql so the Wins feed could refetch on
-- position closes. That was an unfiltered per-row postgres_changes UPDATE
-- subscription on a ~1.6M-row table that live-signal-service.py writes to
-- continuously -- the same fanout that blew the Realtime message quota in
-- Sept 2026 (opportunities was moved to a batched broadcast for the same
-- reason). The Wins feed now polls instead (see SignalsDemo.tsx), so the
-- table no longer needs to be in the publication.
alter publication supabase_realtime drop table opportunity_wallets;
