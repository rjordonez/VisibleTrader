create or replace view trader_scores_compute as
with pos as (
  select r.*, r.usd / r.shares as p,
    r.category not in ('sports', 'esports', 'weather', 'crypto')
      and r.usd / r.shares <= 0.40 and r.usd >= 1000 as longshot
  from trader_market_results r
  where r.shares > 0
),
agg as (
  select wallet,
    count(*)::int as markets,
    (count(*) filter (where won))::int as wins,
    sum(p) as expected_wins,
    sum(p * (1 - p)) as variance,
    sum(usd) as deployed,
    sum(case when won then shares - usd else -usd end) as pnl,
    (count(*) filter (where longshot))::int as longshots,
    (count(*) filter (where longshot and won))::int as longshot_wins,
    coalesce(sum(p) filter (where longshot), 0) as longshot_expected,
    sum(p * (1 - p)) filter (where longshot) as longshot_variance,
    coalesce(sum(case when won then shares - usd else -usd end) filter (where longshot), 0) as longshot_pnl
  from pos
  group by wallet
),
scored as (
  select a.*,
    (a.wins - a.expected_wins) / a.markets * 100 as edge_pts,
    (a.wins - a.expected_wins) / nullif(sqrt(a.variance), 0) as z,
    (a.longshot_wins - a.longshot_expected) / nullif(sqrt(a.longshot_variance), 0) as insider_z
  from agg a
)
select s.wallet, l.wallet_name, s.markets, s.wins, s.expected_wins, s.deployed, s.pnl,
  s.edge_pts, s.z, s.longshots, s.longshot_wins, s.longshot_expected, s.longshot_pnl, s.insider_z,
  (s.markets >= 25 and s.edge_pts >= 5 and coalesce(s.z, 0) >= 2 and s.pnl > 0) as is_expert,
  (s.longshot_wins >= 1 and s.longshot_pnl >= 5000 and coalesce(s.insider_z, 0) >= 1.5 and s.pnl > 0) as is_insider
from scored s
left join leaderboard_cache l on l.wallet = s.wallet;
revoke all on trader_scores_compute from anon, authenticated;
update trader_scores set is_insider = false where is_insider and pnl <= 0;
