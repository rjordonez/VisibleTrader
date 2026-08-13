-- Captures emails from the two marketing-page entry points (the Hero
-- "get started free" form and the /estimate quiz) before the visitor
-- actually creates an account -- both currently just discard the email
-- client-side and either do nothing or link to a generic /pricing page.
-- This table is a pure write-only capture: anon can insert their own
-- email, nobody (not even authenticated users) can read the list back
-- through the public API, since it's marketing data, not something any
-- client needs to query.
create table leads (
  id bigint generated always as identity primary key,
  email text not null,
  source text not null,
  interest text,
  created_at timestamptz not null default now()
);
alter table leads enable row level security;
grant insert on leads to anon, authenticated;
create policy "anyone can submit" on leads for insert with check (true);
