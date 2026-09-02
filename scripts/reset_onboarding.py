#!/usr/bin/env python3
"""Clears onboarding_completed from a user's metadata so ProtectedRoute
routes them back through OnboardingPage on next load.

Usage: python3 scripts/reset_onboarding.py rnordone@usc.edu --target prod
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
            cur.execute('''
                UPDATE auth.users
                SET raw_user_meta_data = raw_user_meta_data - 'onboarding_completed'
                WHERE lower(email) = lower(%s)
            ''', (args.email,))
            if cur.rowcount == 0:
                raise SystemExit(f'No account found for {args.email} on {args.target}.')

    print(f'Cleared onboarding_completed for {args.email} on {args.target}.')


if __name__ == '__main__':
    main()
