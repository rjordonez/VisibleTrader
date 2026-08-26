"""Measures real capture accuracy of the Alchemy on-chain webhook pipeline
(supabase/functions/alchemy-webhook -> onchain_fills -> live-signal-service.py)
against Polymarket's own public trade history — the same cross-check method
used to originally find the 60% miss rate in the old last_trade_price
WebSocket path on 2026-08-26.

Picks the N highest-frequency real traders (by trade count) in the given
window directly from Polymarket's public API — not from our own captured
data, to avoid selection bias toward wallets we happen to cover well — then
checks, per trader, what fraction of their real trades' transaction hashes
landed in onchain_fills. For any misses, fetches the real on-chain receipt
and reports whether the OrderFilled log came from a *different* exchange
contract than the one our webhook is currently filtered to (a known,
already-flagged coverage gap — Polymarket's non-neg-risk CTF Exchange isn't
covered yet) vs. a genuine unexplained miss.

Usage:
    python3 scripts/verify_onchain_coverage.py [--minutes 30] [--n-traders 3]
"""
import argparse
import datetime
import json
import urllib.error
import urllib.request
from collections import Counter

from _env import load_env

UA = {'User-Agent': 'verify-onchain-coverage/1.0'}
# Both contracts the Alchemy webhook is now filtered to (2026-08-26 — the
# webhook originally only covered the Neg Risk exchange; CTF Exchange V2
# was added after this test found ~0% coverage on wallets that turned out
# to trade almost exclusively through it).
COVERED_EXCHANGES = {
    '0xe2222d279d744050d28e00520010520000310f59',  # Neg Risk CTF Exchange V2
    '0xe111180000d2663c0091e4f400237545b87b996b',  # CTF Exchange V2 (regular)
}
ORDER_FILLED_TOPIC = '0xd543adfd945773f1a62f74f0ee55a5e3b9b1a28262980ba90b1a89f2ea84d8ee'
RPC_PROVIDERS = [
    'https://polygon-bor-rpc.publicnode.com',
    'https://1rpc.io/matic',
    'https://polygon.drpc.org',
]


def get_json(url, headers=None):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.load(r)


def fetch_recent_trades(since_ts, max_pages=20):
    """Polymarket's public trades feed, most-recent-first — pages back until
    we cross `since_ts` or hit max_pages (safety valve against a huge window)."""
    trades = []
    offset = 0
    for _ in range(max_pages):
        batch = get_json(f'https://data-api.polymarket.com/trades?limit=100&offset={offset}')
        if not batch:
            break
        trades.extend(batch)
        if batch[-1]['timestamp'] < since_ts:
            break
        offset += 100
    return [t for t in trades if t['timestamp'] >= since_ts]


def fetch_receipt_logs(tx_hash):
    body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'eth_getTransactionReceipt', 'params': [tx_hash]}).encode()
    for rpc in RPC_PROVIDERS:
        try:
            req = urllib.request.Request(rpc, data=body, headers={'Content-Type': 'application/json', **UA})
            with urllib.request.urlopen(req, timeout=10) as r:
                res = json.load(r)
            result = res.get('result')
            if result:
                return result.get('logs', [])
        except Exception:
            continue
    return None


def diagnose_miss(tx_hash):
    logs = fetch_receipt_logs(tx_hash)
    if logs is None:
        return 'could not fetch receipt from any RPC provider'
    order_filled_logs = [lg for lg in logs if (lg.get('topics') or [None])[0] == ORDER_FILLED_TOPIC]
    if not order_filled_logs:
        return 'no OrderFilled log found in this tx at all (unexpected)'
    uncovered_contracts = {lg['address'].lower() for lg in order_filled_logs if lg['address'].lower() not in COVERED_EXCHANGES}
    if uncovered_contracts:
        return f'OrderFilled emitted by a contract NOT in our filter: {", ".join(uncovered_contracts)}'
    return 'unexplained — matched a covered exchange contract but still missing'


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--minutes', type=int, default=30, help='lookback window')
    ap.add_argument('--n-traders', type=int, default=3)
    ap.add_argument('--min-trades', type=int, default=5, help='floor for "high frequency" candidates')
    args = ap.parse_args()

    load_env()
    import os
    import psycopg
    conn = psycopg.connect(os.environ['PROD_DATABASE_URL'])
    cur = conn.cursor()

    since_ts = (datetime.datetime.now(datetime.UTC) - datetime.timedelta(minutes=args.minutes)).timestamp()
    print(f'Pulling real Polymarket trades since {datetime.datetime.fromtimestamp(since_ts, datetime.UTC)}...')
    trades = fetch_recent_trades(since_ts)
    print(f'{len(trades)} real trades in the window.\n')

    counts = Counter(t['proxyWallet'] for t in trades)
    candidates = [w for w, n in counts.most_common() if n >= args.min_trades]
    top_wallets = candidates[:args.n_traders]
    if len(top_wallets) < args.n_traders:
        print(f'WARNING: only found {len(top_wallets)} wallets with >= {args.min_trades} trades in this window — '
              f'widen --minutes or lower --min-trades for a fuller test.\n')

    overall_total = overall_caught = 0
    for wallet in top_wallets:
        wallet_trades = [t for t in trades if t['proxyWallet'] == wallet]
        tx_hashes = {t['transactionHash'] for t in wallet_trades}
        cur.execute('SELECT DISTINCT tx_hash FROM onchain_fills WHERE tx_hash = ANY(%s)', (list(tx_hashes),))
        caught_hashes = {r[0] for r in cur.fetchall()}
        missed_hashes = tx_hashes - caught_hashes

        n_total, n_caught, n_missed = len(tx_hashes), len(caught_hashes), len(missed_hashes)
        overall_total += n_total
        overall_caught += n_caught
        pct = 100 * n_caught / n_total if n_total else 0
        print(f'=== {wallet} — {len(wallet_trades)} trades ({n_total} unique tx) ===')
        print(f'  Caught: {n_caught}/{n_total} ({pct:.1f}%)')
        if missed_hashes:
            print(f'  Diagnosing {n_missed} misses...')
            reasons = Counter()
            for tx_hash in list(missed_hashes)[:10]:  # cap RPC calls for a quick run
                reasons[diagnose_miss(tx_hash)] += 1
            for reason, n in reasons.most_common():
                print(f'    {n}x: {reason}')
            if n_missed > 10:
                print(f'    (+{n_missed - 10} more misses not individually diagnosed, RPC-call budget)')
        print()

    overall_pct = 100 * overall_caught / overall_total if overall_total else 0
    print(f'=== OVERALL: {overall_caught}/{overall_total} ({overall_pct:.1f}%) across {len(top_wallets)} traders ===')
    print('(Compare against the 60% miss rate — i.e. ~40% caught — measured on the old last_trade_price WS path.)')


if __name__ == '__main__':
    main()
