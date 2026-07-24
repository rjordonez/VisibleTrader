#!/usr/bin/env python3
"""Three offline robustness checks on the walk-forward strategy, all computed
from already-cached data (trades_cache.json + resolution_cache_v2.json), no
network calls:

1. Slippage proxy — re-score each signal using the NEXT trader's price after
   the triggering one, instead of the triggering trader's own price. Estimates
   how much worse results look if you can't get in at the exact instant.
2. Concentration check — groups scored signals by settlement DATE (a proxy for
   correlated real-world events, since we don't have precise event-id mapping
   cached) to see how much of total PnL rides on a handful of days.
3. Capital-weighted consensus — an alternate signal definition: trigger when
   cumulative DOLLAR volume from distinct top traders crosses a threshold,
   instead of when a headcount of distinct traders is reached.
"""
import argparse, bisect, json, statistics as stats
from collections import defaultdict
from datetime import datetime, timezone

THRESHOLDS = [1, 2, 3, 5, 10]
MIN_RESOLVED_TRADES = 5
MIN_VOL_FOR_ROI = 500


def build_resolved_buys(trades_by_wallet, resolutions):
    resolved_buys = []
    realized_by_wallet = defaultdict(list)
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


def rolling_windows(wallets, resolved_buys, buy_timestamps, cum_idx, top_k, interval_days, metric):
    """Shared windowing/ranking setup — yields the list of resolved buys made
    by that window's top-K roster, for each rolling window."""
    if not resolved_buys:
        return
    start_ts, end_ts = resolved_buys[0]['timestamp'], resolved_buys[-1]['timestamp']
    interval = interval_days * 86400
    cutoffs = list(range(start_ts + interval, end_ts, interval))
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
        lo = bisect.bisect_left(buy_timestamps, cutoff)
        hi = bisect.bisect_left(buy_timestamps, window_end)
        window_buys = [b for b in resolved_buys[lo:hi] if b['trader'] in top_wallets]
        if window_buys:
            yield window_buys


def build_headcount_and_slippage_signals(wallets, resolved_buys, buy_timestamps, cum_idx, top_k, interval_days, metric):
    baseline, slippage = [], []
    for window_buys in rolling_windows(wallets, resolved_buys, buy_timestamps, cum_idx, top_k, interval_days, metric):
        groups = defaultdict(list)
        for b in window_buys:
            groups[(b['conditionId'], b['outcome'])].append(b)
        for (_, outcome), buys in groups.items():
            buys.sort(key=lambda b: b['timestamp'])
            seen = []
            for idx, b in enumerate(buys):
                if b['trader'] not in seen:
                    seen.append(b['trader'])
                    n = len(seen)
                    if n in THRESHOLDS:
                        entry = b['price']
                        ret = (b['settled_price'] - entry) / entry
                        win = b['settled_price'] >= 0.5
                        baseline.append({'threshold': n, 'return_pct': ret, 'win': win, 'closed_ts': b['closed_ts']})
                        # slippage proxy: price of the NEXT buy after the trigger, if one exists
                        if idx + 1 < len(buys) and buys[idx + 1]['price']:
                            next_price = buys[idx + 1]['price']
                            slip_ret = (b['settled_price'] - next_price) / next_price
                            slippage.append({'threshold': n, 'return_pct': slip_ret, 'win': win})
    return baseline, slippage


def build_dollar_signals(wallets, resolved_buys, buy_timestamps, cum_idx, top_k, interval_days, metric, dollar_thresholds):
    results = defaultdict(list)
    for window_buys in rolling_windows(wallets, resolved_buys, buy_timestamps, cum_idx, top_k, interval_days, metric):
        groups = defaultdict(list)
        for b in window_buys:
            groups[(b['conditionId'], b['outcome'])].append(b)
        for (_, outcome), buys in groups.items():
            buys.sort(key=lambda b: b['timestamp'])
            seen_traders = set()
            cum_dollars = 0.0
            triggered = set()
            for b in buys:
                if b['trader'] not in seen_traders:
                    seen_traders.add(b['trader'])
                    cum_dollars += b.get('usdcSize') or 0
                    for dt in dollar_thresholds:
                        if dt not in triggered and cum_dollars >= dt:
                            triggered.add(dt)
                            entry = b['price']
                            ret = (b['settled_price'] - entry) / entry
                            results[dt].append({'return_pct': ret, 'win': b['settled_price'] >= 0.5})
    return results


def summarize(signals):
    if not signals:
        return {'signal_count': 0, 'win_rate': 0.0, 'mean_return': 0.0}
    win_rate = sum(1 for s in signals if s['win']) / len(signals)
    mean_ret = stats.mean(s['return_pct'] for s in signals)
    return {'signal_count': len(signals), 'win_rate': round(win_rate, 4), 'mean_return': round(mean_ret, 4)}


def concentration_analysis(baseline_signals, threshold=1):
    sigs = [s for s in baseline_signals if s['threshold'] == threshold]
    by_day = defaultdict(float)
    for s in sigs:
        day = datetime.fromtimestamp(s['closed_ts'], tz=timezone.utc).date().isoformat()
        by_day[day] += 100 * s['return_pct']
    total = sum(by_day.values())
    sorted_days = sorted(by_day.items(), key=lambda kv: -abs(kv[1]))
    top1 = sorted_days[0][1] if sorted_days else 0
    top5 = sum(v for _, v in sorted_days[:5])
    top10 = sum(v for _, v in sorted_days[:10])
    return {
        'signal_count': len(sigs), 'unique_days': len(by_day), 'total_pnl_100': round(total, 2),
        'top1_day_pct_of_total': round(top1 / total * 100, 1) if total else 0,
        'top5_days_pct_of_total': round(top5 / total * 100, 1) if total else 0,
        'top10_days_pct_of_total': round(top10 / total * 100, 1) if total else 0,
        'top_days': [[d, round(v, 2)] for d, v in sorted_days[:10]],
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--trades-cache', default='trades_cache.json')
    ap.add_argument('--resolution-cache', default='resolution_cache_v2.json')
    ap.add_argument('--top-k', type=int, default=250)
    ap.add_argument('--interval-days', type=int, default=30)
    ap.add_argument('--metric', default='pnl')
    ap.add_argument('--dollar-thresholds', default='1000,5000,20000,50000,100000')
    ap.add_argument('--out', default='robustness_checks.json')
    args = ap.parse_args()

    print('Loading cached data (no network calls)...')
    trades_by_wallet = json.load(open(args.trades_cache))
    resolutions = json.load(open(args.resolution_cache))
    wallets = list(trades_by_wallet.keys())
    resolved_buys, realized_by_wallet = build_resolved_buys(trades_by_wallet, resolutions)
    buy_timestamps = [b['timestamp'] for b in resolved_buys]
    cum_idx = build_cum_index(realized_by_wallet)
    print(f'{len(resolved_buys)} resolved buys ready. Using top_k={args.top_k}, '
          f'interval={args.interval_days}d, metric={args.metric}.\n')

    # ---- 1. slippage ----
    print('== 1. Slippage proxy (entry at triggering trader vs. next trader in) ==')
    baseline, slippage = build_headcount_and_slippage_signals(
        wallets, resolved_buys, buy_timestamps, cum_idx, args.top_k, args.interval_days, args.metric)
    slippage_report = []
    for t in THRESHOLDS:
        b = summarize([s for s in baseline if s['threshold'] == t])
        s = summarize([s for s in slippage if s['threshold'] == t])
        slippage_report.append({'threshold': t, 'baseline': b, 'slippage_adjusted': s})
        print(f'  {t}+: baseline {b["win_rate"]*100:5.1f}% win / {b["mean_return"]*100:+6.1f}% ret '
              f'({b["signal_count"]} sig)  ->  slippage-adjusted {s["win_rate"]*100:5.1f}% win / '
              f'{s["mean_return"]*100:+6.1f}% ret ({s["signal_count"]} sig)')

    # ---- 2. concentration ----
    print('\n== 2. Concentration by settlement date (threshold=1) ==')
    conc = concentration_analysis(baseline, threshold=1)
    print(f'  {conc["signal_count"]} signals resolved across {conc["unique_days"]} distinct days')
    print(f'  top 1 day = {conc["top1_day_pct_of_total"]:.1f}% of total PnL')
    print(f'  top 5 days = {conc["top5_days_pct_of_total"]:.1f}% of total PnL')
    print(f'  top 10 days = {conc["top10_days_pct_of_total"]:.1f}% of total PnL')
    print('  biggest single days:')
    for day, pnl in conc['top_days'][:5]:
        print(f'    {day}: ${pnl:+,.0f}')

    # ---- 3. capital-weighted consensus ----
    print('\n== 3. Capital-weighted consensus (cumulative $ from distinct traders) ==')
    dollar_thresholds = [int(x) for x in args.dollar_thresholds.split(',')]
    dollar_signals = build_dollar_signals(
        wallets, resolved_buys, buy_timestamps, cum_idx, args.top_k, args.interval_days, args.metric, dollar_thresholds)
    dollar_report = []
    for dt in dollar_thresholds:
        s = summarize(dollar_signals[dt])
        dollar_report.append({'dollar_threshold': dt, **s})
        print(f'  ${dt:>7,}+ agreeing: {s["signal_count"]:>5} signals, {s["win_rate"]*100:5.1f}% win, '
              f'{s["mean_return"]*100:+6.1f}% return')

    out = {
        'config': {'top_k': args.top_k, 'interval_days': args.interval_days, 'metric': args.metric},
        'slippage': slippage_report,
        'concentration': conc,
        'dollar_weighted': dollar_report,
    }
    json.dump(out, open(args.out, 'w'), indent=2)
    print(f'\nSaved {args.out}')


if __name__ == '__main__':
    main()
