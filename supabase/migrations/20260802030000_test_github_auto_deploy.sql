-- Trivial, harmless test to confirm the GitHub integration's "Deploy to
-- production" toggle (just enabled) actually applies migrations on push to
-- main, instead of needing scripts/apply_migration.py every time. Safe to
-- drop once confirmed.
create table if not exists integration_test_ping (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now()
);
