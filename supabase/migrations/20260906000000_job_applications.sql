-- Private bucket: applicants can upload their resume but never list, read,
-- or overwrite anyone else's file. Reviewed by hand via direct dashboard/DB
-- access, same as affiliate_applications.
insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

create policy "anon can upload resumes"
    on storage.objects
    for insert
    to anon
    with check (bucket_id = 'resumes');

create table if not exists public.job_applications (
    id uuid primary key default gen_random_uuid(),
    role text not null default 'growth-intern',
    name text not null,
    email text not null,
    availability text,
    cover_letter text,
    resume_path text,
    created_at timestamptz not null default now()
);

alter table public.job_applications enable row level security;

-- Applications are private, same as affiliate_applications — visitors can
-- submit one but never read them back.
create policy "anon can submit job applications"
    on public.job_applications
    for insert
    to anon
    with check (true);
