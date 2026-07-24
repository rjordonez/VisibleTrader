#!/usr/bin/env python3
"""Walk-forward version of backtest-consensus.py — fixes lookahead/leakage bias.

The naive backtest (backtest-consensus.py) ranks traders by PnL as scraped TODAY,
then scores their entire historical trade log — including trades that are part of
why they rank highly. This version ranks traders using ONLY realized PnL up to a
rolling cutoff date, then only scores trades AFTER that cutoff. The ranking can
never see the trades it's about to grade.

Does NOT fix survivorship bias: the candidate pool is still today's top-1000
wallets, so a trader who was great in the past but blew up since never enters the
pool. See the plan doc for why that's a separate, much bigger project.
"""
import argparse, bisect, json, statistics as stats, threading, time, urllib.error, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

THRESHOLDS = [1, 2, 3, 5, 10]
ACTIVITY_PAGE = 500
ACTIVITY_MAX_PAGES = 20
MIN_RESOLVED_TRADES = 5  # eligibility floor to rank at a cutoff (avoid one-trade luck)

lock = threading.Lock()

PAGINATION_LIMIT = object()  # sentinel: hit the API's hard depth cap, not a transient failure


def get(url, retries=3):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.load(r)
        except urllib.error.HTTPError as e:
            if e.code == 400:
                # Polymarket's /activity endpoint hard-caps around offset+limit=5500 —
                # confirmed live: offset=5000 works, offset>=5400 always 400s, no matter
                # the retry. Retrying is pointless; this isn't a transient failure.
                return PAGINATION_LIMIT
            if attempt == retries - 1:
                return None
            time.sleep(0.5)
        except Exception:
            if attempt == retries - 1:
                return None
            time.sleep(0.5)


def fetch_wallet_buys(wallet):
    """Returns (buys, ok). ok=False means a page fetch failed after retries —
    caller must NOT cache this wallet, so a re-run retries it instead of
    silently treating a network hiccup as 'this wallet has 0 trades'. Hitting
    the API's hard pagination depth limit is NOT treated as a failure — we keep
    whatever was fetched before the wall and mark it ok, since retrying would
    hit the identical 400 every time (it's not transient)."""
    buys = []
    for page in range(ACTIVITY_MAX_PAGES):
        offset = page * ACTIVITY_PAGE
        rows = get(f"https://data-api.polymarket.com/activity?user={wallet}&limit={ACTIVITY_PAGE}&offset={offset}")
        if rows is PAGINATION_LIMIT:
            break  # hit the hard depth cap — keep what we have, this wallet's history is truncated
        if rows is None:
            return buys, False  # fetch failed after retries — don't cache a partial result
        if not rows:
            break  # genuinely no more pages
        for r in rows:
            if r.get('type') == 'TRADE' and r.get('side') == 'BUY':
                buys.append({
                    'trader': wallet,
                    'conditionId': r.get('conditionId'),
                    'outcome': r.get('outcome'),
                    'slug': r.get('slug'),
                    'price': r.get('price'),
                    'usdcSize': r.get('usdcSize'),
                    'timestamp': r.get('timestamp'),
                })
        if len(rows) < ACTIVITY_PAGE:
            break
    return buys, True


def parse_maybe_json(v):
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return v
    return v


def parse_closed_time(s):
    if not s:
        return None
    s = s.strip()
    if s.endswith('Z'):
        s = s[:-1] + '+00:00'
    elif s.endswith('+00'):
        s = s[:-3] + '+00:00'
    if ' ' in s and 'T' not in s:
        s = s.replace(' ', 'T', 1)
    try:
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.timestamp()
    except Exception:
        return None


def fetch_resolution(slug):
    rows = get(f"https://gamma-api.polymarket.com/markets?slug={slug}&closed=true")
    if not rows:
        return None
    m = rows[0]
    outcomes = parse_maybe_json(m.get('outcomes'))
    prices = parse_maybe_json(m.get('outcomePrices'))
    if not outcomes or not prices or len(outcomes) != len(prices):
        return None
    closed_ts = parse_closed_time(m.get('closedTime'))
    if closed_ts is None:
        return None
    return {'prices': {o: float(p) for o, p in zip(outcomes, prices)}, 'closed_ts': closed_ts}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--users', default='polymarket_users.json')
    ap.add_argument('--sample', type=int, default=1000, help='candidate pool size (still survivorship-biased)')
    ap.add_argument('--interval-days', type=int, default=30)
    ap.add_argument('--top-k', type=int, default=100, help='how many top-ranked traders to follow per window')
    ap.add_argument('--workers', type=int, default=64)
    ap.add_argument('--out', default='walkforward_results.json')
    ap.add_argument('--trades-cache', default='trades_cache.json')
    ap.add_argument('--resolution-cache', default='resolution_cache_v2.json')
    args = ap.parse_args()

    print(f'Loading top {args.sample} candidate traders from {args.users}...')
    users = json.load(open(args.users))
    users = sorted(users, key=lambda u: -(u['best_pnl'] if u['best_pnl'] is not None else -1e18))[:args.sample]
    wallets = [u['wallet'] for u in users]

    trades_by_wallet = {}
    try:
        trades_by_wallet = json.load(open(args.trades_cache))
        print(f'Loaded cached trades for {len(trades_by_wallet)} wallets from {args.trades_cache}')
    except FileNotFoundError:
        pass

    to_fetch = [w for w in wallets if w not in trades_by_wallet]
    print(f'{len(wallets)} candidate wallets, {len(to_fetch)} need a fresh activity fetch ({args.workers} workers)...')
    done = 0
    failed = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(fetch_wallet_buys, w): w for w in to_fetch}
        for fut in as_completed(futures):
            wallet = futures[fut]
            buys, ok = fut.result()
            with lock:
                done += 1
                if ok:
                    trades_by_wallet[wallet] = buys
                else:
                    failed += 1  # left out of the cache on purpose — a re-run will retry it
                if done % 100 == 0 or done == len(to_fetch):
                    suffix = f' ({failed} failed, will retry on next run)' if failed else ''
                    print(f'  {done}/{len(to_fetch)} wallets fetched{suffix}')
                if done % 500 == 0:
                    json.dump(trades_by_wallet, open(args.trades_cache, 'w'))  # checkpoint — survives a crash/interrupt
    if to_fetch:
        json.dump(trades_by_wallet, open(args.trades_cache, 'w'))
        print(f'Saved trade cache to {args.trades_cache}')

    all_buys = [b for w in wallets for b in trades_by_wallet.get(w, [])]
    print(f'\n{len(all_buys)} total buy trades across {len(wallets)} wallets.')

    unique_slugs = sorted({b['slug'] for b in all_buys if b.get('slug')})
    resolutions = {}
    try:
        resolutions = json.load(open(args.resolution_cache))
        print(f'Loaded {len(resolutions)} cached resolutions from {args.resolution_cache}')
    except FileNotFoundError:
        pass

    to_check = [s for s in unique_slugs if s not in resolutions]
    print(f'{len(unique_slugs)} unique markets touched, {len(to_check)} need a fresh resolution lookup '
          f'({args.workers} workers)...')
    done = 0
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(fetch_resolution, s): s for s in to_check}
        for fut in as_completed(futures):
            slug = futures[fut]
            res = fut.result()
            with lock:
                done += 1
                if res:
                    resolutions[slug] = res
                if done % 200 == 0 or done == len(to_check):
                    print(f'  {done}/{len(to_check)} markets checked — {len(resolutions)} resolved total')
                if done % 2000 == 0:
                    json.dump(resolutions, open(args.resolution_cache, 'w'))  # checkpoint — survives a crash/interrupt
    if to_check:
        json.dump(resolutions, open(args.resolution_cache, 'w'))
        print(f'Saved resolution cache to {args.resolution_cache}')

    # ---- build each wallet's chronological realized-PnL events ----
    print('\nReconstructing point-in-time realized PnL per wallet...')
    realized_by_wallet = defaultdict(list)  # wallet -> sorted [(closed_ts, dollar_pnl), ...]
    resolved_buys = []  # buys whose market has resolved, annotated with settle info
    for b in all_buys:
        res = resolutions.get(b.get('slug'))
        if not res or b['outcome'] not in res['prices'] or not b.get('price') or not b.get('usdcSize'):
            continue
        settled = res['prices'][b['outcome']]
        entry = b['price']
        dollar_pnl = b['usdcSize'] * (settled - entry) / entry
        realized_by_wallet[b['trader']].append((res['closed_ts'], dollar_pnl))
        resolved_buys.append({**b, 'settled_price': settled, 'closed_ts': res['closed_ts']})

    for w in realized_by_wallet:
        realized_by_wallet[w].sort(key=lambda e: e[0])
    cum_by_wallet = {}  # wallet -> (sorted_times, cumulative_pnl_list)
    for w, events in realized_by_wallet.items():
        times = [e[0] for e in events]
        cum = []
        running = 0.0
        for _, pnl in events:
            running += pnl
            cum.append(running)
        cum_by_wallet[w] = (times, cum)

    def realized_pnl_and_count_before(wallet, cutoff):
        times, cum = cum_by_wallet.get(wallet, ([], []))
        idx = bisect.bisect_left(times, cutoff)
        if idx == 0:
            return 0.0, 0
        return cum[idx - 1], idx

    # ---- rolling walk-forward windows ----
    if not all_buys:
        print('No trade data available.')
        return
    start_ts = min(b['timestamp'] for b in all_buys if b.get('timestamp'))
    end_ts = max(b['timestamp'] for b in all_buys if b.get('timestamp'))
    interval = args.interval_days * 86400
    cutoffs = list(range(start_ts + interval, end_ts, interval))
    print(f'\nRunning {len(cutoffs)} walk-forward windows ({args.interval_days}-day steps)...\n')

    all_scored = []
    windows_with_signals = 0
    for i, cutoff in enumerate(cutoffs):
        window_end = cutoffs[i + 1] if i + 1 < len(cutoffs) else end_ts + 1

        eligible = []
        for w in wallets:
            pnl, n = realized_pnl_and_count_before(w, cutoff)
            if n >= MIN_RESOLVED_TRADES:
                eligible.append((w, pnl))
        if not eligible:
            continue
        eligible.sort(key=lambda e: -e[1])
        top_wallets = {w for w, _ in eligible[:args.top_k]}

        window_buys = [b for b in resolved_buys
                       if b['trader'] in top_wallets and cutoff <= b['timestamp'] < window_end]
        if not window_buys:
            continue

        groups = defaultdict(list)
        for b in window_buys:
            groups[(b['conditionId'], b['outcome'])].append(b)

        for (_, outcome), buys in groups.items():
            buys.sort(key=lambda b: b['timestamp'])
            seen_traders = []
            for b in buys:
                if b['trader'] not in seen_traders:
                    seen_traders.append(b['trader'])
                    n = len(seen_traders)
                    if n in THRESHOLDS:
                        entry = b['price']
                        ret = (b['settled_price'] - entry) / entry
                        all_scored.append({
                            'threshold': n, 'slug': b['slug'], 'outcome': outcome,
                            'entry_price': entry, 'settled_price': b['settled_price'],
                            'return_pct': ret, 'win': b['settled_price'] >= 0.5,
                            'timestamp': b['timestamp'],
                        })
        windows_with_signals += 1

    print(f'{windows_with_signals}/{len(cutoffs)} windows produced signals. Scoring...\n')

    results = []
    for threshold in THRESHOLDS:
        scored = [s for s in all_scored if s['threshold'] == threshold]
        if scored:
            win_rate = sum(1 for s in scored if s['win']) / len(scored)
            mean_ret = stats.mean(s['return_pct'] for s in scored)
            median_ret = stats.median(s['return_pct'] for s in scored)
            total_pnl_100 = sum(100 * s['return_pct'] for s in scored)
            lo, hi = min(s['timestamp'] for s in scored), max(s['timestamp'] for s in scored)
            span_days = max(1, (hi - lo) / 86400)
            per_week = len(scored) / span_days * 7
        else:
            win_rate = mean_ret = median_ret = total_pnl_100 = span_days = per_week = 0

        results.append({
            'threshold': threshold, 'signal_count': len(scored),
            'win_rate': round(win_rate, 4), 'mean_return': round(mean_ret, 4),
            'median_return': round(median_ret, 4), 'total_pnl_100': round(total_pnl_100, 2),
            'span_days': round(span_days, 1), 'signals_per_week': round(per_week, 2),
        })
        print(f'  {threshold}+ traders agreeing: {len(scored):>5} signals, '
              f'{win_rate*100:5.1f}% win rate, {mean_ret*100:+6.1f}% mean return, '
              f'${total_pnl_100:+.0f} total ($100/signal)')

    out = {
        'methodology': 'walk_forward',
        'interval_days': args.interval_days,
        'top_k': args.top_k,
        'min_resolved_trades': MIN_RESOLVED_TRADES,
        'windows_total': len(cutoffs),
        'windows_with_signals': windows_with_signals,
        'thresholds': results,
    }
    json.dump(out, open(args.out, 'w'), indent=2)
    print(f'\nSaved {args.out}')


if __name__ == '__main__':
    main()
