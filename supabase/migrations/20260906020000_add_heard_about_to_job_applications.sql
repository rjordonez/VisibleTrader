alter table public.job_applications add column if not exists heard_about text;
alter table public.job_applications add column if not exists linkedin_url text;
alter table public.job_applications add column if not exists work_authorized text;
alter table public.job_applications add column if not exists referred_by text;
