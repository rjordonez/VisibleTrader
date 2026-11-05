-- The public status page shows the last 24 hours in 30-minute blocks.
-- live-signal-service adds each minute's state to the block it falls in
-- and prunes blocks older than 3 days.
create table if not exists public_status_intervals (
  bucket timestamptz not null,
  component text not null,
  operational_minutes integer not null default 0,
  degraded_minutes integer not null default 0,
  outage_minutes integer not null default 0,
  primary key (bucket, component)
);

alter table public_status_intervals enable row level security;

drop policy if exists "public status intervals are readable by anyone" on public_status_intervals;
create policy "public status intervals are readable by anyone" on public_status_intervals
  for select to anon, authenticated using (true);

grant select on public_status_intervals to anon, authenticated;
