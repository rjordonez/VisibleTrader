#!/usr/bin/env python3
"""One-time backfill: copies everything from the local venter_signals.db
SQLite file into the new Supabase Postgres tables (see
supabase/migrations/*.sql). Run once, after the migration file has been
applied, before flipping live-signal-service.py / signals-proxy.mjs over to
DATABASE_URL. Safe to re-run against an empty set of Postgres tables; not
safe to run twice against tables that already have data (no dedup — this is
a one-shot migration, not an ongoing sync).

Usage: python3 scripts/backfill_supabase.py [--db venter_signals.db]
Requires DATABASE_URL in the environment or .env (same as live-signal-service.py).
"""
import argparse
import os
import sqlite3
from datetime import datetime, timezone

import psycopg

ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')


def load_env_file(path):
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            os.environ.setdefault(key.strip(), value.strip())


load_env_file(ENV_PATH)


def parse_ts(value):
    """SQLite stored these as ISO text (datetime.isoformat()); psycopg wants
    real datetime objects for timestamptz columns."""
    if value is None:
        return None
    return datetime.fromisoformat(value)


def to_bool(value):
    """SQLite stored these as INTEGER 0/1/NULL; Postgres columns are boolean."""
    if value is None:
        return None
    return bool(value)


def backfill_opportunities(sconn, pconn):
    rows = sconn.execute('''SELECT condition_id, outcome, slug, title, cumulative_usd, tier,
        wallet_count, first_seen, last_updated, latest_price, category FROM opportunities''').fetchall()
    data = [
        (r[0], r[1], r[2], r[3], r[4], r[5], r[6], parse_ts(r[7]), parse_ts(r[8]), r[9], r[10])
        for r in rows
    ]
    with pconn.cursor() as cur:
        cur.executemany('''INSERT INTO opportunities
            (condition_id, outcome, slug, title, cumulative_usd, tier, wallet_count, first_seen, last_updated, latest_price, category)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (condition_id, outcome, tier) DO NOTHING''', data)
    pconn.commit()
    print(f'  opportunities: {len(data)} rows')


def backfill_opportunity_wallets(sconn, pconn):
    rows = sconn.execute('''SELECT condition_id, outcome, wallet, wallet_name, usd, price, ts,
        exit_ts, exit_price, exit_usd, hold_seconds, is_scalp, market_closed, resolved_win, resolved_ts
        FROM opportunity_wallets''').fetchall()
    data = [
        (r[0], r[1], r[2], r[3], r[4], r[5], parse_ts(r[6]), parse_ts(r[7]), r[8], r[9], r[10],
         to_bool(r[11]), to_bool(r[12]), to_bool(r[13]), parse_ts(r[14]))
        for r in rows
    ]
    with pconn.cursor() as cur:
        cur.executemany('''INSERT INTO opportunity_wallets
            (condition_id, outcome, wallet, wallet_name, usd, price, ts, exit_ts, exit_price, exit_usd,
             hold_seconds, is_scalp, market_closed, resolved_win, resolved_ts)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''', data)
    pconn.commit()
    print(f'  opportunity_wallets: {len(data)} rows')


def backfill_ticker(sconn, pconn):
    rows = sconn.execute('''SELECT condition_id, outcome, slug, title, usd, price, side, tx_hash,
        wallet, wallet_name, roster_tagged, category, ts, epoch FROM ticker''').fetchall()
    data = [
        (r[0], r[1], r[2], r[3], r[4], r[5], r[6], r[7], r[8], r[9], to_bool(r[10]), r[11], parse_ts(r[12]), r[13])
        for r in rows
    ]
    with pconn.cursor() as cur:
        cur.executemany('''INSERT INTO ticker
            (condition_id, outcome, slug, title, usd, price, side, tx_hash, wallet, wallet_name,
             roster_tagged, category, ts, epoch)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)''', data)
    pconn.commit()
    print(f'  ticker: {len(data)} rows')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default='venter_signals.db')
    ap.add_argument('--database-url', default=os.environ.get('DATABASE_URL'))
    args = ap.parse_args()

    if not args.database_url:
        raise SystemExit('DATABASE_URL not set — export it or pass --database-url')
    if not os.path.exists(args.db):
        raise SystemExit(f'{args.db} not found')

    sconn = sqlite3.connect(args.db)
    pconn = psycopg.connect(args.database_url)

    print(f'Backfilling {args.db} -> Supabase Postgres...')
    backfill_opportunities(sconn, pconn)
    backfill_opportunity_wallets(sconn, pconn)
    backfill_ticker(sconn, pconn)
    print('Done.')

    sconn.close()
    pconn.close()


if __name__ == '__main__':
    main()
