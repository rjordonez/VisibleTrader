-- Backfilled from the remote project's migration history — this was applied
-- directly and never committed. Content matches what's actually live.
ALTER TABLE app_settings
  ADD COLUMN IF NOT EXISTS whale_roster_size integer NOT NULL DEFAULT 300,
  ADD COLUMN IF NOT EXISTS active_roster_size integer NOT NULL DEFAULT 700;
