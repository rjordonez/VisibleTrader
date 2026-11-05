-- Public status page (visibletrader.com/status). live-signal-service's
-- health report writes one row per customer-facing component every minute,
-- and folds each minute into a per-day tally for the uptime bars. Only
-- plain-language component names and Operational/Degraded/Outage states
-- live here; the detailed internal checks stay in PostHog.
create table if not exists public_status (
  component text primary key,
  status text not null check (status in ('operational', 'degraded', 'outage')),
  updated_at timestamptz not null default now()
);

create table if not exists public_status_daily (
  day date not null,
  component text not null,
  operational_minutes integer not null default 0,
  degraded_minutes integer not null default 0,
  outage_minutes integer not null default 0,
  primary key (day, component)
);

alter table public_status enable row level security;
alter table public_status_daily enable row level security;

drop policy if exists "public status is readable by anyone" on public_status;
create policy "public status is readable by anyone" on public_status
  for select to anon, authenticated using (true);

drop policy if exists "public status history is readable by anyone" on public_status_daily;
create policy "public status history is readable by anyone" on public_status_daily
  for select to anon, authenticated using (true);

grant select on public_status, public_status_daily to anon, authenticated;
