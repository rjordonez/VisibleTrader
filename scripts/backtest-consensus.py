#!/usr/bin/env python3
"""Backtests the 'copy what top traders agree on' idea against resolved markets.

For each (market, outcome) that top traders bought into, finds the moment the
Nth distinct trader entered (for N in THRESHOLDS) and simulates buying at that
trader's price, holding to resolution. Compares win rate / return across
thresholds, including a threshold=1 baseline (copy any single top trader alone).
"""
import argparse, json, statistics as stats, threading, time, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

THRESHOLDS = [1, 2, 3, 5, 10]
ACTIVITY_PAGE = 500
ACTIVITY_MAX_PAGES = 20  # safety cap per wallet (10k trades)

lock = threading.Lock()


def get(url, retries=3):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.load(r)
        except Exception:
            if attempt == retries - 1:
                return None
            time.sleep(0.5)


def fetch_wallet_buys(wallet):
    buys = []
    for page in range(ACTIVITY_MAX_PAGES):
        offset = page * ACTIVITY_PAGE
        rows = get(f"https://data-api.polymarket.com/activity?user={wallet}&limit={ACTIVITY_PAGE}&offset={offset}")
        if not rows:
            break
        for r in rows:
            if r.get('type') == 'TRADE' and r.get('side') == 'BUY':
                buys.append({
                    'trader': wallet,
                    'conditionId': r.get('conditionId'),
                    'outcome': r.get('outcome'),
                    'slug': r.get('slug'),
                    'price': r.get('price'),
                    'timestamp': r.get('timestamp'),
                })
        if len(rows) < ACTIVITY_PAGE:
            break
    return buys


def parse_maybe_json(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return v
    return v


def fetch_resolution(slug):
    rows = get(f"https://gamma-api.polymarket.com/markets?slug={slug}&closed=true")
    if not rows:
        return None
    m = rows[0]
    outcomes = parse_maybe_json(m.get('outcomes'))
    prices = parse_maybe_json(m.get('outcomePrices'))
    if not outcomes or not prices or len(outcomes) != len(prices):
        return None
    return {o: float(p) for o, p in zip(outcomes, prices)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--users', default='polymarket_users.json')
    ap.add_argument('--sample', type=int, default=1000, help='number of top traders to pull trade history for')
    ap.add_argument('--workers', type=int, default=64)
    ap.add_argument('--out', default='backtest_results.json')
    ap.add_argument('--resolution-cache', default='resolution_cache.json',
                     help='resolved markets are permanent, so cache them across runs')
    ap.add_argument('--frequency-only', action='store_true',
                     help='skip the resolution/scoring phase entirely — just report how '
                          'often each agreement threshold occurs and over what time span')
    args = ap.parse_args()

    print(f'Loading top {args.sample} traders from {args.users}...')
    users = json.load(open(args.users))
    users = sorted(users, key=lambda u: -(u['best_pnl'] if u['best_pnl'] is not None else -1e18))[:args.sample]
    wallets = [u['wallet'] for u in users]

    print(f'Fetching trade activity for {len(wallets)} wallets ({args.workers} workers)...')
    all_buys = []
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(fetch_wallet_buys, w): w for w in wallets}
        for fut in as_completed(futures):
            buys = fut.result()
            with lock:
                done += 1
                all_buys.extend(buys)
                if done % 100 == 0 or done == len(wallets):
                    print(f'  {done}/{len(wallets)} wallets — {len(all_buys)} buy trades collected so far')

    print(f'\n{len(all_buys)} total buy trades. Grouping by (market, outcome)...')
    groups = defaultdict(list)
    for b in all_buys:
        if b['conditionId'] and b['outcome'] is not None and b['timestamp'] is not None:
            groups[(b['conditionId'], b['outcome'])].append(b)

    # signal[threshold] = list of (slug, outcome, entry_price, n_distinct_traders_at_signal)
    signals = defaultdict(list)
    slug_by_condition = {}
    for (condition_id, outcome), buys in groups.items():
        buys.sort(key=lambda b: b['timestamp'])
        seen_traders = []
        for b in buys:
            if b['trader'] not in seen_traders:
                seen_traders.append(b['trader'])
                slug_by_condition[condition_id] = b['slug']
                n = len(seen_traders)
                if n in THRESHOLDS:
                    signals[n].append({
                        'conditionId': condition_id, 'outcome': outcome,
                        'entry_price': b['price'], 'slug': b['slug'],
                        'timestamp': b['timestamp'],
                    })

    if args.frequency_only:
        print('\n--frequency-only: skipping resolution lookups.\n')
        freq = []
        for threshold in THRESHOLDS:
            sigs = signals[threshold]
            if sigs:
                lo, hi = min(s['timestamp'] for s in sigs), max(s['timestamp'] for s in sigs)
                span_days = max(1, (hi - lo) / 86400)
                per_week = len(sigs) / span_days * 7
            else:
                lo = hi = span_days = per_week = 0
            freq.append({
                'threshold': threshold, 'signal_count': len(sigs),
                'span_days': round(span_days, 1), 'signals_per_week': round(per_week, 2),
                'earliest': lo, 'latest': hi,
            })
            print(f'  {threshold}+ traders agreeing: {len(sigs):>6} times, spanning {span_days:.0f} days '
                  f'(~{per_week:.1f}/week)')
        json.dump(freq, open(args.out.replace('.json', '_frequency.json'), 'w'), indent=2)
        return

    unique_slugs = sorted(set(slug_by_condition.values()))

    resolutions = {}
    try:
        resolutions = json.load(open(args.resolution_cache))
        print(f'Loaded {len(resolutions)} cached resolutions from {args.resolution_cache}')
    except FileNotFoundError:
        pass

    to_fetch = [s for s in unique_slugs if s not in resolutions]
    print(f'{len(unique_slugs)} unique markets touched, {len(to_fetch)} need a fresh lookup '
          f'({args.workers} workers)...')
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(fetch_resolution, s): s for s in to_fetch}
        for fut in as_completed(futures):
            slug = futures[fut]
            res = fut.result()
            with lock:
                done += 1
                if res:
                    resolutions[slug] = res
                if done % 200 == 0 or done == len(to_fetch):
                    print(f'  {done}/{len(to_fetch)} markets checked — {len(resolutions)} resolved total')

    json.dump(resolutions, open(args.resolution_cache, 'w'))
    print(f'\n{len(resolutions)} of {len(unique_slugs)} touched markets are resolved '
          f'(cache saved to {args.resolution_cache}). Scoring signals...\n')

    results = []
    all_scored = []
    for threshold in THRESHOLDS:
        scored = []
        for sig in signals[threshold]:
            res = resolutions.get(sig['slug'])
            if not res or sig['outcome'] not in res or not sig['entry_price']:
                continue
            settled = res[sig['outcome']]
            entry = sig['entry_price']
            ret = (settled - entry) / entry
            win = settled >= 0.5
            scored.append({**sig, 'threshold': threshold, 'settled_price': settled, 'return_pct': ret, 'win': win})

        if scored:
            win_rate = sum(1 for s in scored if s['win']) / len(scored)
            mean_ret = stats.mean(s['return_pct'] for s in scored)
            median_ret = stats.median(s['return_pct'] for s in scored)
            total_pnl_100 = sum(100 * s['return_pct'] for s in scored)
        else:
            win_rate = mean_ret = median_ret = total_pnl_100 = 0

        if scored:
            span_days = max(1, (max(s['timestamp'] for s in scored) - min(s['timestamp'] for s in scored)) / 86400)
            per_week = len(scored) / span_days * 7
        else:
            span_days = per_week = 0

        results.append({
            'threshold': threshold,
            'signal_count': len(scored),
            'win_rate': round(win_rate, 4),
            'mean_return': round(mean_ret, 4),
            'median_return': round(median_ret, 4),
            'total_pnl_100': round(total_pnl_100, 2),
            'span_days': round(span_days, 1),
            'signals_per_week': round(per_week, 2),
        })
        all_scored.extend(scored)

        print(f'  {threshold}+ traders agreeing: {len(scored):>5} signals over {span_days:.0f} days '
              f'(~{per_week:.1f}/week), {win_rate*100:5.1f}% win rate, {mean_ret*100:+6.1f}% mean return, '
              f'${total_pnl_100:+.0f} total ($100/signal)')

    all_scored.sort(key=lambda s: -s['return_pct'])
    notable_signals = [
        {'threshold': s['threshold'], 'slug': s['slug'], 'outcome': s['outcome'],
         'entry_price': s['entry_price'], 'settled_price': s['settled_price'],
         'return_pct': round(s['return_pct'], 4)}
        for s in (all_scored[:20] + list(reversed(all_scored[-20:])))
    ]

    out = {'thresholds': results, 'notable_signals': notable_signals}
    json.dump(out, open(args.out, 'w'), indent=2)
    print(f'\nSaved {args.out}')


if __name__ == '__main__':
    main()
