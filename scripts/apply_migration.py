#!/usr/bin/env python3
"""Applies a migration file directly to dev or prod via psycopg — the
Supabase GitHub integration has never once auto-applied a migration in this
project, so this is the real deploy path, just made reusable instead of
hand-writing a one-off script each time.

Usage: python3 scripts/apply_migration.py supabase/migrations/some_file.sql --target dev|prod
Requires DEV_DATABASE_URL / PROD_DATABASE_URL in the environment or .env
(.env.local wins over .env, matching Vite's own precedence).
"""
import argparse
import os

import psycopg

ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env')
ENV_LOCAL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env.local')


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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('migration_file')
    ap.add_argument('--target', choices=['dev', 'prod'], required=True)
    args = ap.parse_args()

    # .env first, then .env.local overrides — same precedence Vite uses, so
    # a value present in both resolves the same way here as it does for the
    # frontend.
    load_env_file(ENV_PATH)
    load_env_file(ENV_LOCAL_PATH)

    var_name = 'DEV_DATABASE_URL' if args.target == 'dev' else 'PROD_DATABASE_URL'
    database_url = os.environ.get(var_name)
    if not database_url:
        raise SystemExit(f'{var_name} not set in .env or .env.local')

    with open(args.migration_file) as f:
        sql = f.read()

    print(f'Applying {args.migration_file} to {args.target}...')
    with psycopg.connect(database_url, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
    print(f'Applied successfully to {args.target}.')


if __name__ == '__main__':
    main()
