-- The Insiders list only shows wallets we can say *why* about. A long-shot
-- win alone isn't evidence; each listed hit needs at least one hard signal
-- the Leaderboard states in words:
--   quick       bought within 48 hours of the result
--   few_bets    account with 10 or fewer markets ever
--   new_account account created within 30 days of the bet
-- Hits without one (timing unknown, established account) stay in
-- insider_hits but aren't listed. Replaces the view from
-- 20261103030000_insider_discovery.sql (columns changed, so drop + create).
drop view if exists insider_leaders;
create view insider_leaders with (security_invoker = true) as
with vetted as (
  select h.*, w.trades, w.join_date,
    coalesce(h.buy_hours_before <= 48, false) as quick,
    coalesce(w.trades <= 10, false) as few_bets,
    coalesce(h.first_buy_at - w.join_date <= interval '30 days', false) as new_account,
    floor(extract(epoch from (h.first_buy_at - w.join_date)) / 86400)::int as account_age_days
  from insider_hits h
  join insider_wallets w on w.wallet = h.wallet
  where h.is_pattern
),
listed as (
  select * from vetted where quick or few_bets or new_account
)
select b.wallet,
  coalesce(w.wallet_name, b.wallet_name) as wallet_name,
  b.trades, coalesce(w.open_positions, 0) as open_positions, coalesce(w.open_usd, 0) as open_usd,
  s.hits, s.total_pnl,
  b.event_title, b.event_slug, b.initial_value, b.final_value, b.pnl as best_pnl,
  b.entry_odds, b.buy_hours_before, b.quick, b.few_bets, b.new_account, b.account_age_days
from (
  select wallet, count(*)::int as hits, sum(pnl) as total_pnl from listed group by wallet
) s
join (
  select distinct on (wallet) * from listed order by wallet, pnl desc
) b on b.wallet = s.wallet
left join insider_wallets w on w.wallet = s.wallet;
grant select on insider_leaders to authenticated;
