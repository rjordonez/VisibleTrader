#!/usr/bin/env python3
"""One-time (re-runnable) sync: copies polymarket_users.json into the
Supabase wallet_directory table so the Lookup page can search all ~286k
wallets by address or username without shipping the 241MB local file
anywhere. Upserts on wallet, so re-running after the JSON refreshes just
updates existing rows and adds new ones — not a destructive wipe-and-reload.

Usage: python3 scripts/sync_wallet_directory.py [--users polymarket_users.json]
Requires DATABASE_URL in the environment or .env (same as live-signal-service.py).
"""
import argparse
import json
import os

import psycopg

ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
BATCH_SIZE = 2000


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--users', default='polymarket_users.json')
    ap.add_argument('--database-url', default=os.environ.get('DATABASE_URL'))
    args = ap.parse_args()

    if not args.database_url:
        raise SystemExit('DATABASE_URL not set — export it or pass --database-url')

    all_users = json.load(open(args.users))
    print(f'Syncing {len(all_users)} wallets from {args.users}...')

    conn = psycopg.connect(args.database_url)
    total = 0
    with conn.cursor() as cur:
        batch = []
        for u in all_users:
            batch.append((
                u['wallet'].lower(), u.get('username'), u.get('xUsername'),
                bool(u.get('verified')), u.get('best_pnl'),
            ))
            if len(batch) >= BATCH_SIZE:
                cur.executemany('''INSERT INTO wallet_directory (wallet, username, x_username, verified, best_pnl)
                    VALUES (%s,%s,%s,%s,%s)
                    ON CONFLICT (wallet) DO UPDATE SET
                        username = EXCLUDED.username, x_username = EXCLUDED.x_username,
                        verified = EXCLUDED.verified, best_pnl = EXCLUDED.best_pnl''', batch)
                conn.commit()
                total += len(batch)
                print(f'  {total} synced...')
                batch = []
        if batch:
            cur.executemany('''INSERT INTO wallet_directory (wallet, username, x_username, verified, best_pnl)
                VALUES (%s,%s,%s,%s,%s)
                ON CONFLICT (wallet) DO UPDATE SET
                    username = EXCLUDED.username, x_username = EXCLUDED.x_username,
                    verified = EXCLUDED.verified, best_pnl = EXCLUDED.best_pnl''', batch)
            conn.commit()
            total += len(batch)

    print(f'Done. {total} wallets synced.')
    conn.close()


if __name__ == '__main__':
    main()
