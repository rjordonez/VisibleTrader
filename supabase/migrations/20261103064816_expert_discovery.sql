create table if not exists expert_traders (
  wallet         text primary key,
  wallet_name    text,
  positions      integer not null,
  wins           integer not null,
  win_rate       numeric not null,
  cost           numeric not null,
  pnl            numeric not null,
  roi            numeric not null,
  t_stat         numeric not null,
  avg_odds       numeric not null,
  is_expert      boolean not null,
  open_positions integer not null default 0,
  open_usd       numeric not null default 0,
  updated_at     timestamptz not null default now()
);
create index if not exists expert_traders_expert_idx on expert_traders (t_stat desc) where is_expert;

alter table expert_traders enable row level security;
drop policy if exists "public read" on expert_traders;
create policy "public read" on expert_traders for select using (
  exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'))
);
grant select on expert_traders to authenticated;
