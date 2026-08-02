#!/usr/bin/env python3
"""Throwaway concurrency stress test for the two races fixed in
live-signal-service.py's connection-pooling change (see the "Real
connection pooling" plan, step 5):

  A) record_tier_crossed's is_current flip — many concurrent tier
     crossings on the same market must leave exactly one is_current=true
     row, at the true max tier, regardless of commit order.
  B) record_exit's FIFO SELECT-then-UPDATE — many concurrent SELLs racing
     for the same wallet's open positions must close each open row exactly
     once (no double-close, no lost close).

Run against DEV only. Writes and then deletes synthetic
condition_id='__stress_test_<ts>__' rows — never touches real market data.
Exits 1 if any assertion fails.
"""
import importlib.util
import os
import random
import sys
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('lss', os.path.join(SCRIPT_DIR, 'live-signal-service.py'))
lss = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lss)  # loads .env/.env.local into os.environ as a side effect

DATABASE_URL = os.environ.get('DATABASE_URL', '')
if 'vohtqodprqpobvvcdypy' in DATABASE_URL:
    print('Refusing to run: DATABASE_URL points at PRODUCTION.')
    sys.exit(1)
if not DATABASE_URL:
    print('DATABASE_URL not set (checked .env.local / .env / environment).')
    sys.exit(1)

db = lss.Database(DATABASE_URL)
COND = f'__stress_test_{uuid.uuid4().hex[:8]}__'
OUTCOME = 'Yes'
WALLET = '0xstresstestwallet' + uuid.uuid4().hex[:24]
failures = []


def check(label, ok, detail=''):
    status = 'PASS' if ok else 'FAIL'
    print(f'  [{status}] {label}' + (f' — {detail}' if detail and not ok else ''))
    if not ok:
        failures.append(label)


def cleanup():
    db.execute('DELETE FROM opportunity_stats WHERE condition_id = %s', (COND,))
    db.execute('DELETE FROM opportunity_contributors WHERE condition_id = %s', (COND,))
    db.execute('DELETE FROM opportunity_wallets WHERE condition_id = %s', (COND,))
    db.execute('DELETE FROM opportunities WHERE condition_id = %s', (COND,))


def test_tier_crossed_race():
    print(f'\n[A] record_tier_crossed concurrency (condition_id={COND})')
    meta_lookup = {(COND, OUTCOME): {'slug': None, 'title': 'STRESS TEST', 'eventId': None, 'eventSlug': None}}
    tiers = lss.TIERS  # [1000, 5000, 20000, 50000, 100000]
    calls = []
    for _ in range(4):  # a few repeated rounds, shuffled, to force out-of-order commits
        round_tiers = list(tiers)
        random.shuffle(round_tiers)
        calls.extend(round_tiers)

    def fire(tier):
        lss.record_tier_crossed(db, COND, OUTCOME, meta_lookup, cumulative_usd=tier, tier=tier,
                                 wallet_count=1, price=0.5, trade_ts=datetime.now(timezone.utc))

    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(fire, calls))

    rows = db.fetchall(
        'SELECT tier, is_current FROM opportunities WHERE condition_id = %s AND outcome = %s ORDER BY tier',
        (COND, OUTCOME))
    current_rows = [r for r in rows if r[1]]
    check('exactly one is_current row', len(current_rows) == 1, f'got {len(current_rows)}: {rows}')
    if current_rows:
        check('is_current row is the true max tier', current_rows[0][0] == max(tiers),
              f'is_current tier={current_rows[0][0]}, max tier={max(tiers)}')
    check('all tiers were inserted', len(rows) == len(tiers), f'got {len(rows)} rows: {rows}')


def test_record_exit_race():
    print(f'\n[B] record_exit concurrency (wallet={WALLET[:16]}…)')
    n_open = 8
    base_ts = datetime.now(timezone.utc) - timedelta(hours=1)
    for i in range(n_open):
        lss.record_contribution(db, COND, OUTCOME, WALLET, 'stresstester', usd=100, price=0.5,
                                 trade_ts=base_ts + timedelta(seconds=i))

    n_attempts = 24  # more concurrent SELLs than open positions

    def fire(_):
        return lss.record_exit(db, COND, OUTCOME, WALLET, price=0.6, usd=100, trade_ts=datetime.now(timezone.utc))

    with ThreadPoolExecutor(max_workers=16) as pool:
        results = list(pool.map(fire, range(n_attempts)))

    n_closed = sum(1 for r in results if r is not None)
    check('exactly n_open exits succeeded (no lost closes)', n_closed == n_open,
          f'{n_closed} succeeded out of {n_open} open positions')

    row = db.fetchone(
        'SELECT COUNT(*) FROM opportunity_wallets WHERE condition_id=%s AND outcome=%s AND wallet=%s AND exit_ts IS NOT NULL',
        (COND, OUTCOME, WALLET))
    check('exactly n_open rows show exit_ts set (no double-close)', row[0] == n_open, f'got {row[0]}')

    row = db.fetchone(
        'SELECT COUNT(*) FROM opportunity_wallets WHERE condition_id=%s AND outcome=%s AND wallet=%s AND exit_ts IS NULL',
        (COND, OUTCOME, WALLET))
    check('zero rows remain open', row[0] == 0, f'got {row[0]}')

    stats_row = db.fetchone(
        '''SELECT entries, exited, realized_profit, open_shares_sum, open_invested_usd
           FROM opportunity_stats WHERE condition_id=%s AND outcome=%s''', (COND, OUTCOME))
    entries, exited, realized_profit, open_shares_sum, open_invested_usd = stats_row
    check('entries == n_open', entries == n_open, f'got {entries}')
    check('exited == n_open', exited == n_open, f'got {exited}')
    # each buy: $100 @ 0.5 -> 200 shares; each exit @ 0.6 -> realized_delta = 200*0.6-100 = 20
    expected_profit = n_open * 20
    check('realized_profit matches hand-computed total', abs(float(realized_profit) - expected_profit) < 0.01,
          f'got {realized_profit}, expected {expected_profit}')
    check('open_shares_sum drained to 0', abs(float(open_shares_sum)) < 0.01, f'got {open_shares_sum}')
    check('open_invested_usd drained to 0', abs(float(open_invested_usd)) < 0.01, f'got {open_invested_usd}')


try:
    test_tier_crossed_race()
    test_record_exit_race()
finally:
    cleanup()

print()
if failures:
    print(f'FAILED: {len(failures)} check(s) failed — {failures}')
    sys.exit(1)
print('All concurrency stress checks passed.')
