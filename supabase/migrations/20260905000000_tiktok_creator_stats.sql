-- Mirrors creator_stats (the Instagram Reels scraper's table) for the new
-- TikTok scraper — same shape, minus the IG-only columns (media_type,
-- like_count, comment_count, taken_at) that TikTok's scraper doesn't
-- collect.
create table if not exists public.tiktok_creator_stats (
    id uuid primary key default gen_random_uuid(),
    creator text not null,
    media_pk text not null,
    view_count integer,
    checked_at timestamptz not null default now()
);

create index if not exists tiktok_creator_stats_creator_checked_at_idx
    on public.tiktok_creator_stats (creator, checked_at desc);

alter table public.tiktok_creator_stats enable row level security;

-- Same open anon insert/select policies as creator_stats: the scraper writes
-- with the anon key (no service role in play), and the public Creator
-- Leaderboard page reads with it too.
create policy "anon can insert tiktok creator stats"
    on public.tiktok_creator_stats
    for insert
    to anon
    with check (true);

create policy "anon can select tiktok creator stats"
    on public.tiktok_creator_stats
    for select
    to anon
    using (true);

-- Was IG-only (public.creator_stats); now sums the latest run from both
-- platforms so the Live Activity goal reflects total reach, not just IG.
create or replace function public.public_total_view_count()
returns integer
language sql
stable
as $$
    select (
        coalesce(
            (select sum(view_count) from public.creator_stats
             where checked_at = (select max(checked_at) from public.creator_stats)),
            0
        )
        +
        coalesce(
            (select sum(view_count) from public.tiktok_creator_stats
             where checked_at = (select max(checked_at) from public.tiktok_creator_stats)),
            0
        )
    )::integer
$$;
