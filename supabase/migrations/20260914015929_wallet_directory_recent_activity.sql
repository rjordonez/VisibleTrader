-- Backfilled from the remote project's migration history — this was applied
-- directly and never committed. Content matches what's actually live.
ALTER TABLE wallet_directory
  ADD COLUMN IF NOT EXISTS recent_pnl numeric,
  ADD COLUMN IF NOT EXISTS recent_rank_seen boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_wallet_directory_recent_pnl
  ON wallet_directory (recent_pnl DESC)
  WHERE recent_rank_seen;
