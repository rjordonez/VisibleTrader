#!/usr/bin/env python3
"""Sweeps walk-forward strategy variants entirely from cached data (no network
calls) — pool size, ranking window length, and ranking metric (raw PnL vs ROI).
Requires trades_cache.json + resolution_cache_v2.json from a prior
backtest-walkforward.py run.
"""
import argparse, bisect, json, statistics as stats
from collections import defaultdict

THRESHOLDS = [1, 2, 3, 5, 10]
MIN_RESOLVED_TRADES = 5
MIN_VOL_FOR_ROI = 500  # avoid tiny-sample ROI noise dominating the ROI-ranked variant


def build_resolved_buys(trades_by_wallet, resolutions):
    resolved_buys = []
    realized_by_wallet = defaultdict(list)  # wallet -> [(closed_ts, dollar_pnl, usdcSize)]
    for wallet, buys in trades_by_wallet.items():
        for b in buys:
            res = resolutions.get(b.get('slug'))
            if not res or b['outcome'] not in res.get('prices', {}) or not b.get('price') or not b.get('usdcSize'):
                continue
            settled = res['prices'][b['outcome']]
            entry = b['price']
            dollar_pnl = b['usdcSize'] * (settled - entry) / entry
            realized_by_wallet[wallet].append((res['closed_ts'], dollar_pnl, b['usdcSize']))
            resolved_buys.append({**b, 'settled_price': settled, 'closed_ts': res['closed_ts']})
    for w in realized_by_wallet:
        realized_by_wallet[w].sort(key=lambda e: e[0])
    resolved_buys.sort(key=lambda b: b['timestamp'])
    return resolved_buys, realized_by_wallet


def build_cum_index(realized_by_wallet):
    idx = {}
    for w, events in realized_by_wallet.items():
        times, cum_pnl, cum_vol = [], [], []
        rp = rv = 0.0
        for t, pnl, vol in events:
            rp += pnl
            rv += vol
            times.append(t)
            cum_pnl.append(rp)
            cum_vol.append(rv)
        idx[w] = (times, cum_pnl, cum_vol)
    return idx


def rank_score(cum_idx, wallet, cutoff, metric):
    times, cum_pnl, cum_vol = cum_idx.get(wallet, ([], [], []))
    i = bisect.bisect_left(times, cutoff)
    if i < MIN_RESOLVED_TRADES:
        return None
    pnl, vol = cum_pnl[i - 1], cum_vol[i - 1]
    if metric == 'pnl':
        return pnl
    if vol < MIN_VOL_FOR_ROI:
        return None
    return pnl / vol


def evaluate(wallets, resolved_buys, buy_timestamps, cum_idx, top_k, interval_days, metric):
    if not resolved_buys:
        return []
    start_ts, end_ts = resolved_buys[0]['timestamp'], resolved_buys[-1]['timestamp']
    interval = interval_days * 86400
    cutoffs = list(range(start_ts + interval, end_ts, interval))

    all_scored = []
    for i, cutoff in enumerate(cutoffs):
        window_end = cutoffs[i + 1] if i + 1 < len(cutoffs) else end_ts + 1

        scored_wallets = []
        for w in wallets:
            s = rank_score(cum_idx, w, cutoff, metric)
            if s is not None:
                scored_wallets.append((w, s))
        if not scored_wallets:
            continue
        scored_wallets.sort(key=lambda e: -e[1])
        top_wallets = {w for w, _ in scored_wallets[:top_k]}

        # slice resolved_buys to this window via bisect on the pre-sorted-by-timestamp list
        lo = bisect.bisect_left(buy_timestamps, cutoff)
        hi = bisect.bisect_left(buy_timestamps, window_end)
        window_slice = resolved_buys[lo:hi]
        window_buys = [b for b in window_slice if b['trader'] in top_wallets]
        if not window_buys:
            continue

        groups = defaultdict(list)
        for b in window_buys:
            groups[(b['conditionId'], b['outcome'])].append(b)
        for (_, outcome), buys in groups.items():
            buys.sort(key=lambda b: b['timestamp'])
            seen = []
            for b in buys:
                if b['trader'] not in seen:
                    seen.append(b['trader'])
                    n = len(seen)
                    if n in THRESHOLDS:
                        entry = b['price']
                        ret = (b['settled_price'] - entry) / entry
                        all_scored.append({'threshold': n, 'return_pct': ret, 'win': b['settled_price'] >= 0.5})
    return all_scored


def evaluate_single_split(wallets, resolved_buys, buy_timestamps, cum_idx, top_k, train_frac, metric):
    """Rank the roster ONCE at a single cutoff, then treat the entire rest of the
    timeline as one continuous test window — unlike the rolling version, the
    'who's in the club' list never resets, so there's far more time for many
    distinct traders to independently converge on the same bet (needed to get
    any real sample size at the higher agreement thresholds)."""
    if not resolved_buys:
        return []
    start_ts, end_ts = resolved_buys[0]['timestamp'], resolved_buys[-1]['timestamp']
    cutoff = start_ts + int((end_ts - start_ts) * train_frac)

    scored_wallets = []
    for w in wallets:
        s = rank_score(cum_idx, w, cutoff, metric)
        if s is not None:
            scored_wallets.append((w, s))
    if not scored_wallets:
        return []
    scored_wallets.sort(key=lambda e: -e[1])
    top_wallets = {w for w, _ in scored_wallets[:top_k]}

    lo = bisect.bisect_left(buy_timestamps, cutoff)
    test_buys = [b for b in resolved_buys[lo:] if b['trader'] in top_wallets]
    if not test_buys:
        return []

    all_scored = []
    groups = defaultdict(list)
    for b in test_buys:
        groups[(b['conditionId'], b['outcome'])].append(b)
    for (_, outcome), buys in groups.items():
        buys.sort(key=lambda b: b['timestamp'])
        seen = []
        for b in buys:
            if b['trader'] not in seen:
                seen.append(b['trader'])
                n = len(seen)
                if n in THRESHOLDS:
                    entry = b['price']
                    ret = (b['settled_price'] - entry) / entry
                    all_scored.append({'threshold': n, 'return_pct': ret, 'win': b['settled_price'] >= 0.5})
    return all_scored


def summarize(all_scored, threshold):
    scored = [s for s in all_scored if s['threshold'] == threshold]
    if not scored:
        return {'signal_count': 0, 'win_rate': 0.0, 'mean_return': 0.0}
    win_rate = sum(1 for s in scored if s['win']) / len(scored)
    mean_ret = stats.mean(s['return_pct'] for s in scored)
    return {'signal_count': len(scored), 'win_rate': round(win_rate, 4), 'mean_return': round(mean_ret, 4)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--trades-cache', default='trades_cache.json')
    ap.add_argument('--resolution-cache', default='resolution_cache_v2.json')
    ap.add_argument('--mode', choices=['rolling', 'single-split'], default='rolling',
                     help='rolling = re-rank every N days (default). single-split = rank once, '
                          'test continuously over the rest of the timeline — needed to get enough '
                          'high-agreement-threshold signals to actually mean something.')
    ap.add_argument('--out', default=None)
    ap.add_argument('--top-ks', default='20,50,100,250,500')
    ap.add_argument('--intervals', default='14,30,60,90', help='rolling mode only')
    ap.add_argument('--train-fracs', default='0.25,0.35,0.5', help='single-split mode only')
    ap.add_argument('--metrics', default='pnl,roi')
    ap.add_argument('--min-signals', type=int, default=100,
                     help='minimum threshold-1 signal count to be eligible for the "best" ranking')
    args = ap.parse_args()
    out_path = args.out or ('strategy_sweep.json' if args.mode == 'rolling' else 'strategy_sweep_single_split.json')

    print('Loading cached data (no network calls)...')
    trades_by_wallet = json.load(open(args.trades_cache))
    resolutions = json.load(open(args.resolution_cache))
    wallets = list(trades_by_wallet.keys())
    print(f'{len(wallets)} wallets, {len(resolutions)} cached resolutions. Building resolved-trade index...')

    resolved_buys, realized_by_wallet = build_resolved_buys(trades_by_wallet, resolutions)
    buy_timestamps = [b['timestamp'] for b in resolved_buys]
    cum_idx = build_cum_index(realized_by_wallet)
    print(f'{len(resolved_buys)} resolved buys ready.\n')

    top_ks = [int(x) for x in args.top_ks.split(',')]
    metrics = args.metrics.split(',')
    results = []

    if args.mode == 'rolling':
        intervals = [int(x) for x in args.intervals.split(',')]
        total = len(top_ks) * len(intervals) * len(metrics)
        done = 0
        for metric in metrics:
            for interval_days in intervals:
                for top_k in top_ks:
                    scored = evaluate(wallets, resolved_buys, buy_timestamps, cum_idx, top_k, interval_days, metric)
                    s1, s2 = summarize(scored, 1), summarize(scored, 2)
                    results.append({'top_k': top_k, 'interval_days': interval_days, 'metric': metric,
                                     'threshold_1': s1, 'threshold_2': s2})
                    done += 1
                    print(f'  [{done:>3}/{total}] top_k={top_k:>4} interval={interval_days:>3}d metric={metric:<4} -> '
                          f'1+: {s1["signal_count"]:>5} sig, {s1["win_rate"]*100:5.1f}% win, {s1["mean_return"]*100:+6.1f}% ret')

        json.dump(results, open(out_path, 'w'), indent=2)
        print(f'\nSaved {out_path}')
        eligible = [r for r in results if r['threshold_1']['signal_count'] >= args.min_signals]
        eligible.sort(key=lambda r: -r['threshold_1']['mean_return'])
        print(f'\nTop 5 by threshold-1 mean return (min {args.min_signals} signals, {len(eligible)}/{len(results)} qualify):')
        for r in eligible[:5]:
            t1 = r['threshold_1']
            print(f'  top_k={r["top_k"]:>4} interval={r["interval_days"]:>3}d metric={r["metric"]:<4} -> '
                  f'{t1["signal_count"]} signals, {t1["win_rate"]*100:.1f}% win, {t1["mean_return"]*100:+.1f}% return')

    else:  # single-split
        train_fracs = [float(x) for x in args.train_fracs.split(',')]
        total = len(top_ks) * len(train_fracs) * len(metrics)
        done = 0
        for metric in metrics:
            for train_frac in train_fracs:
                for top_k in top_ks:
                    scored = evaluate_single_split(wallets, resolved_buys, buy_timestamps, cum_idx, top_k, train_frac, metric)
                    thresholds = {t: summarize(scored, t) for t in THRESHOLDS}
                    results.append({'top_k': top_k, 'train_frac': train_frac, 'metric': metric, 'thresholds': thresholds})
                    done += 1
                    counts = ' '.join(f'{t}+:{thresholds[t]["signal_count"]}' for t in THRESHOLDS)
                    print(f'  [{done:>3}/{total}] top_k={top_k:>4} train_frac={train_frac:<4} metric={metric:<4} -> {counts}')

        json.dump(results, open(out_path, 'w'), indent=2)
        print(f'\nSaved {out_path}')
        print('\nFull threshold breakdown per config:')
        for r in results:
            print(f'\n  top_k={r["top_k"]} train_frac={r["train_frac"]} metric={r["metric"]}:')
            for t in THRESHOLDS:
                s = r['thresholds'][t]
                print(f'    {t}+: {s["signal_count"]:>5} signals, {s["win_rate"]*100:5.1f}% win, {s["mean_return"]*100:+6.1f}% return')


if __name__ == '__main__':
    main()
