#!/usr/bin/env python3
"""One-time backfill for opportunities.event_slug on existing rows (added by
migration 20260802040000). New rows get this populated automatically by
live-signal-service.py going forward; this catches everything written before
that change shipped.

Usage: python3 scripts/backfill_event_slug.py --target dev|prod
"""
import argparse
import json
import os
import urllib.request

import psycopg

ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
ENV_LOCAL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env.local')
UA = {'User-Agent': 'Mozilla/5.0'}
BATCH_SIZE = 20


def load_env_file(path):
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, value = line.partition('=')
            os.environ[key.strip()] = value.strip()


def _fetch(condition_ids, extra_qs=''):
    qs = '&'.join(f'condition_ids={cid}' for cid in condition_ids)
    req = urllib.request.Request(f'https://gamma-api.polymarket.com/markets?{qs}{extra_qs}', headers=UA)
    with urllib.request.urlopen(req, timeout=20) as resp:
        return json.load(resp)


def fetch_event_slugs(condition_ids):
    # gamma-api's `closed` param is a strict filter, not a default-include-all:
    # omitted/false returns only OPEN markets, closed=true returns only CLOSED
    # ones. A resolved sports market (the common case — games finish within
    # hours) would silently vanish from a single unparameterized query, so
    # this checks both and merges.
    markets = _fetch(condition_ids) + _fetch(condition_ids, '&closed=true')
    result = {}
    for m in markets:
        events = m.get('events')
        event_slug = events[0].get('slug') if events else None
        result[m.get('conditionId')] = event_slug or m.get('slug')
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--target', choices=['dev', 'prod'], required=True)
    args = ap.parse_args()

    load_env_file(ENV_PATH)
    load_env_file(ENV_LOCAL_PATH)
    var_name = 'DEV_DATABASE_URL' if args.target == 'dev' else 'PROD_DATABASE_URL'
    database_url = os.environ.get(var_name)
    if not database_url:
        raise SystemExit(f'{var_name} not set in .env or .env.local')

    with psycopg.connect(database_url, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute('SELECT DISTINCT condition_id FROM opportunities WHERE event_slug IS NULL')
            condition_ids = [row[0] for row in cur.fetchall()]
        print(f'{len(condition_ids)} distinct condition_ids need backfill on {args.target}.')

        updated = 0
        for i in range(0, len(condition_ids), BATCH_SIZE):
            batch = condition_ids[i:i + BATCH_SIZE]
            try:
                slugs = fetch_event_slugs(batch)
            except Exception as e:
                print(f'  batch {i}: fetch failed ({e}), skipping')
                continue
            with conn.cursor() as cur:
                for cid, event_slug in slugs.items():
                    if event_slug:
                        cur.execute('UPDATE opportunities SET event_slug=%s WHERE condition_id=%s AND event_slug IS NULL',
                                    (event_slug, cid))
                        updated += cur.rowcount
            print(f'  batch {i}..{i+len(batch)}: {len(slugs)} resolved')

        print(f'Backfill complete on {args.target}: {updated} rows updated.')


if __name__ == '__main__':
    main()
