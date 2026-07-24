#!/usr/bin/env python3
import argparse, json, time, threading, urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

PAGE = 50
MAX_RANK_DEFAULT = 10000  # leaderboard hard-caps here per (category, timePeriod, orderBy) combo

ALL_CATEGORIES = [
    'OVERALL', 'POLITICS', 'SPORTS', 'ESPORTS', 'CRYPTO', 'CULTURE',
    'MENTIONS', 'WEATHER', 'ECONOMICS', 'TECH', 'FINANCE',
]
ALL_TIME_PERIODS = ['DAY', 'WEEK', 'MONTH', 'ALL']
ALL_ORDER_BYS = ['PNL', 'VOL']

seen = {}
lock = threading.Lock()
completed = 0

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

def fetch_page(category, time_period, order_by, offset, page_size):
    url = (
        f"https://data-api.polymarket.com/v1/leaderboard"
        f"?category={category}&timePeriod={time_period}&orderBy={order_by}"
        f"&limit={page_size}&offset={offset}"
    )
    return category, time_period, order_by, get(url)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--out', default='polymarket_users.json')
    ap.add_argument('--max-rank', type=int, default=MAX_RANK_DEFAULT)
    ap.add_argument('--categories', default=','.join(ALL_CATEGORIES))
    ap.add_argument('--time-periods', default=','.join(ALL_TIME_PERIODS))
    ap.add_argument('--order-bys', default=','.join(ALL_ORDER_BYS))
    ap.add_argument('--workers', type=int, default=24)
    args = ap.parse_args()

    categories = args.categories.split(',')
    time_periods = args.time_periods.split(',')
    order_bys = args.order_bys.split(',')

    tasks = [
        (cat, tp, ob, off)
        for cat in categories
        for tp in time_periods
        for ob in order_bys
        for off in range(0, args.max_rank, PAGE)
    ]
    print(f"Scraping {len(categories)} categories x {len(time_periods)} time periods x "
          f"{len(order_bys)} sort orders x {args.max_rank} ranks deep "
          f"= {len(tasks)} requests, {args.workers} workers in parallel\n")

    global completed
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = [ex.submit(fetch_page, cat, tp, ob, off, PAGE) for cat, tp, ob, off in tasks]
        for fut in as_completed(futures):
            category, time_period, order_by, page = fut.result()
            with lock:
                completed += 1
                if page:
                    for t in page:
                        wallet = t['proxyWallet']
                        rec = seen.setdefault(wallet, {
                            'wallet': wallet,
                            'username': None,
                            'xUsername': None,
                            'verified': False,
                            'rankings': [],
                        })
                        rec['username'] = t.get('userName') or rec['username']
                        rec['xUsername'] = t.get('xUsername') or rec['xUsername']
                        rec['verified'] = rec['verified'] or t.get('verifiedBadge', False)
                        rec['rankings'].append({
                            'category': category,
                            'timePeriod': time_period,
                            'orderBy': order_by,
                            'rank': int(t['rank']),
                            'pnl': t.get('pnl'),
                            'vol': t.get('vol'),
                        })
                if completed % 200 == 0 or completed == len(tasks):
                    print(f"  {completed}/{len(tasks)} requests done — {len(seen)} unique wallets so far")

    for rec in seen.values():
        rec['appearances'] = len(rec['rankings'])
        best = max(rec['rankings'], key=lambda r: r['pnl'] if r['pnl'] is not None else -1e18)
        rec['best_pnl'] = best['pnl']
        rec['best_pnl_context'] = {'category': best['category'], 'timePeriod': best['timePeriod']}

    users = sorted(seen.values(), key=lambda u: -(u['best_pnl'] if u['best_pnl'] is not None else -1e18))
    with open(args.out, 'w') as f:
        json.dump(users, f, indent=2)
    print(f"\nSaved {len(users)} unique users to {args.out}")

if __name__ == '__main__':
    main()
