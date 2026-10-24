-- Private analytics written by analyze-market after authenticated submissions.
create table public.analyzer_submissions (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id uuid references auth.users(id) on delete set null,
  input_type text not null check (input_type in ('url', 'screenshot')),
  submitted_url text,
  market_url text,
  market_title text,
  status text not null check (status in ('completed', 'choose_market', 'failed')),
  response_status integer not null check (response_status between 200 and 599)
);

create index analyzer_submissions_created_at_idx on public.analyzer_submissions (created_at desc);
create index analyzer_submissions_user_id_idx on public.analyzer_submissions (user_id);
alter table public.analyzer_submissions enable row level security;
revoke all on table public.analyzer_submissions from public, anon, authenticated;
grant select, insert, update, delete on table public.analyzer_submissions to service_role;
comment on table public.analyzer_submissions is 'Backend-only analyzer request metadata. No screenshot data. Picker steps and retries are separate submissions.';
