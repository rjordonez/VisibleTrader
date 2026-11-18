create table if not exists insider_wallets (
  wallet         text primary key,
  wallet_name    text,
  trades         integer,
  join_date      timestamptz,
  open_positions integer not null default 0,
  open_usd       numeric not null default 0,
  stats_at       timestamptz
);

create table if not exists insider_hits (
  wallet           text not null,
  position_id      text not null,
  wallet_name      text,
  condition_id     text not null,
  event_title      text not null,
  event_slug       text not null,
  category         text not null,
  initial_value    numeric not null,
  final_value      numeric not null,
  pnl              numeric not null,
  entry_odds       numeric not null,
  multiplier       numeric not null,
  resolved_at      timestamptz not null,
  first_buy_at     timestamptz,
  buy_hours_before numeric,
  score            integer not null,
  is_pattern       boolean not null,
  discovered_at    timestamptz not null default now(),
  primary key (wallet, position_id)
);
create index if not exists insider_hits_pattern_idx on insider_hits (wallet, pnl desc) where is_pattern;

create table if not exists insider_alerts (
  wallet        text not null,
  token_id      text not null,
  wallet_name   text,
  condition_id  text not null,
  question      text not null,
  event_title   text not null,
  event_slug    text not null,
  category      text not null,
  outcome       text not null,
  entry_cost    numeric not null,
  avg_price     numeric not null,
  current_price numeric not null,
  current_value numeric not null,
  end_date      timestamptz not null,
  score         integer not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  primary key (wallet, token_id)
);

do $$
declare t text;
begin
  foreach t in array array['insider_wallets', 'insider_hits', 'insider_alerts'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists "public read" on %I', t);
    execute format($p$create policy "public read" on %I for select using (
      exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'))
    )$p$, t);
    execute format('grant select on %I to authenticated', t);
  end loop;
end $$;

create or replace view insider_leaders with (security_invoker = true) as
select s.wallet,
  coalesce(w.wallet_name, b.wallet_name) as wallet_name,
  w.trades, w.join_date, coalesce(w.open_positions, 0) as open_positions, coalesce(w.open_usd, 0) as open_usd,
  s.hits, s.total_pnl, s.top_score,
  b.event_title, b.event_slug, b.initial_value, b.final_value, b.pnl as best_pnl,
  b.multiplier, b.entry_odds, b.buy_hours_before, b.resolved_at
from (
  select wallet, count(*)::int as hits, sum(pnl) as total_pnl, max(score) as top_score
  from insider_hits where is_pattern group by wallet
) s
join (
  select distinct on (wallet) * from insider_hits where is_pattern order by wallet, pnl desc
) b on b.wallet = s.wallet
left join insider_wallets w on w.wallet = s.wallet;
grant select on insider_leaders to authenticated;
