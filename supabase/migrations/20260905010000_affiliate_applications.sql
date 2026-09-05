create table if not exists public.affiliate_applications (
    id uuid primary key default gen_random_uuid(),
    email text not null,
    social_handle text,
    created_at timestamptz not null default now()
);

alter table public.affiliate_applications enable row level security;

-- Applications are private, unlike creator_stats' open leaderboard data —
-- visitors can submit one but never read them back. Reviewed by hand via
-- direct DB access, same as every other admin task in this project.
create policy "anon can submit affiliate applications"
    on public.affiliate_applications
    for insert
    to anon
    with check (true);
