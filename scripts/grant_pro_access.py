#!/usr/bin/env python3
"""Grants an existing user permanent Pro access by upserting a subscriptions
row with no Stripe subscription behind it — has_active_subscription() (see
supabase/migrations/20260808000000_gate_product_data_by_subscription.sql)
only checks `status in ('trialing', 'active')`, so status='active' with no
current_period_end enforcement grants access indefinitely. The user must
already have signed up (an auth.users row) — this doesn't create accounts.

Usage: python3 scripts/grant_pro_access.py rexjordonez@gmail.com --target prod
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
            cur.execute('SELECT id FROM auth.users WHERE lower(email) = lower(%s)', (args.email,))
            row = cur.fetchone()
            if row is None:
                raise SystemExit(f'No account found for {args.email} on {args.target} — they need to sign up first.')
            user_id = row[0]

            cur.execute('''
                INSERT INTO subscriptions (user_id, plan, status, current_period_end)
                VALUES (%s, 'pro', 'active', '2099-12-31T00:00:00Z')
                ON CONFLICT (user_id) DO UPDATE SET
                  plan = 'pro', status = 'active', current_period_end = '2099-12-31T00:00:00Z',
                  updated_at = now()
            ''', (user_id,))

    print(f'Granted permanent Pro access to {args.email} on {args.target}.')


if __name__ == '__main__':
    main()
