#!/usr/bin/env python3
"""Permanently deletes an account from auth.users (cascades to Supabase's
own internal auth.* tables — identities, sessions, refresh_tokens — via
their own FKs). Confirmed no public schema table currently references
auth.users, so this is the whole deletion; if that ever changes, delete
from the referencing table first.

Usage: python3 scripts/delete_account.py someone@example.com --target prod
Requires DEV_DATABASE_URL / PROD_DATABASE_URL in the environment or .env
(.env.local wins over .env, matching Vite's own precedence).
"""
import argparse
import os

import psycopg

from _env import load_env


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('email')
    ap.add_argument('--target', choices=['dev', 'prod'], required=True)
    args = ap.parse_args()

    load_env()

    var_name = 'DEV_DATABASE_URL' if args.target == 'dev' else 'PROD_DATABASE_URL'
    database_url = os.environ.get(var_name)
    if not database_url:
        raise SystemExit(f'{var_name} not set in .env or .env.local')

    with psycopg.connect(database_url, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute('DELETE FROM auth.users WHERE lower(email) = lower(%s)', (args.email,))
            if cur.rowcount == 0:
                raise SystemExit(f'No account found for {args.email} on {args.target}.')

    print(f'Deleted {args.email} from {args.target}.')


if __name__ == '__main__':
    main()
