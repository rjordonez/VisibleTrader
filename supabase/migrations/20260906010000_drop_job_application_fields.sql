-- social_handle/portfolio_url were removed from the application form before
-- anyone had actually applied — dropping the now-unused columns rather than
-- leaving dead schema around.
alter table public.job_applications drop column if exists social_handle;
alter table public.job_applications drop column if exists portfolio_url;
