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
create policy "public status intervals are readable by anyone" on public_status_intervals for select to anon, authenticated using (true);
grant select on public_status_intervals to anon, authenticated;
