#!/usr/bin/env python3
"""One-time backfill for opportunity_stats/opportunity_contributors from the
current opportunity_wallets table (added by migration 20260802060000). This
is the last real GROUP BY over opportunity_wallets we ever run on this
data — a real full scan, run once, not on a hot path. Going forward,
live-signal-service.py maintains these tables incrementally at write time.

Ambiguous resolutions (resolved_win IS NULL) count as a wash in
realized_profit (no gain, no loss) — they already count as neither won nor
lost in the tallies; this fixes the prior inconsistency where the old view
docked a full loss for these.

Usage: python3 scripts/backfill_opportunity_stats.py --target dev|prod
"""
import argparse
import os
import sys

import psycopg

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
from _env import load_env


CONTRIBUTORS_SQL = '''
    insert into opportunity_contributors (condition_id, outcome, wallet)
    select distinct condition_id, outcome, wallet
    from opportunity_wallets
    where wallet is not null
    on conflict do nothing
'''

STATS_SQL = '''
    insert into opportunity_stats
        (condition_id, outcome, entries, wallet_count, cumulative_usd,
         exited, scalped, closed, won, lost,
         realized_profit, open_shares_sum, open_invested_usd, updated_at)
    select
        condition_id, outcome,
        count(*) as entries,
        count(distinct wallet) as wallet_count,
        sum(usd) as cumulative_usd,
        sum((exit_ts is not null)::int) as exited,
        sum((is_scalp is true)::int) as scalped,
        sum((market_closed is true)::int) as closed,
        sum((market_closed is true and resolved_win is true)::int) as won,
        sum((market_closed is true and resolved_win is false)::int) as lost,
        sum(case
            when exit_ts is not null then (usd / price) * exit_price - usd
            when market_closed is true and resolved_win is true then (usd / price) - usd
            when market_closed is true and resolved_win is false then -usd
            else 0
        end) as realized_profit,
        sum(case when exit_ts is null and market_closed is not true then usd / price else 0 end) as open_shares_sum,
        sum(case when exit_ts is null and market_closed is not true then usd else 0 end) as open_invested_usd,
        now()
    from opportunity_wallets
    group by condition_id, outcome
    on conflict (condition_id, outcome) do update set
        entries = excluded.entries,
        wallet_count = excluded.wallet_count,
        cumulative_usd = excluded.cumulative_usd,
        exited = excluded.exited,
        scalped = excluded.scalped,
        closed = excluded.closed,
        won = excluded.won,
        lost = excluded.lost,
        realized_profit = excluded.realized_profit,
        open_shares_sum = excluded.open_shares_sum,
        open_invested_usd = excluded.open_invested_usd,
        updated_at = excluded.updated_at
'''


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--target', choices=['dev', 'prod'], required=True)
    args = ap.parse_args()

    load_env()
    var_name = 'DEV_DATABASE_URL' if args.target == 'dev' else 'PROD_DATABASE_URL'
    database_url = os.environ.get(var_name)
    if not database_url:
        raise SystemExit(f'{var_name} not set in .env or .env.local')

    with psycopg.connect(database_url, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(CONTRIBUTORS_SQL)
            print(f'opportunity_contributors: {cur.rowcount} rows inserted on {args.target}.')
            cur.execute(STATS_SQL)
            print(f'opportunity_stats: {cur.rowcount} rows upserted on {args.target}.')


if __name__ == '__main__':
    main()
