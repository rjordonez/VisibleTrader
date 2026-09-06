-- The Instagram Reels scraper's table. Predates this repo's migration
-- history (it was created directly against prod), so preview/fresh
-- databases never had it — added here so 20260905000000_tiktok_creator_stats
-- (which references public.creator_stats) can build cleanly from scratch.
create table if not exists public.creator_stats (
    id uuid primary key default gen_random_uuid(),
    creator text not null,
    media_pk text not null,
    media_type integer,
    view_count integer,
    like_count integer,
    comment_count integer,
    taken_at timestamptz,
    checked_at timestamptz not null default now()
);

create index if not exists creator_stats_creator_checked_at_idx
    on public.creator_stats (creator, checked_at desc);

alter table public.creator_stats enable row level security;

drop policy if exists "anon can insert creator stats" on public.creator_stats;
create policy "anon can insert creator stats"
    on public.creator_stats
    for insert
    to anon
    with check (true);

drop policy if exists "anon can select creator stats" on public.creator_stats;
create policy "anon can select creator stats"
    on public.creator_stats
    for select
    to anon
    using (true);
