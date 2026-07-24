#!/usr/bin/env python3
"""Aggregates polymarket_users.json (+ optional backtest_results.json) into
polymarket_dashboard.html — a single self-contained page. No external deps,
no network calls."""
import argparse, json, math, random, re, statistics as stats
from collections import Counter, defaultdict

CATEGORIES = [
    'OVERALL', 'POLITICS', 'SPORTS', 'ESPORTS', 'CRYPTO', 'CULTURE',
    'MENTIONS', 'WEATHER', 'ECONOMICS', 'TECH', 'FINANCE',
]

ADDR_RE = re.compile(r'^0x[0-9a-f]{10,}$', re.I)


def pnl_bucket(v):
    """Returns (sort_key, label) for the log-scale bucket v falls into."""
    if v is None:
        return None
    sign = -1 if v < 0 else 1
    a = abs(v)
    if a < 100:
        lo, hi = 0, 100
    else:
        lo = 10 ** math.floor(math.log10(a))
        hi = lo * 10
    fmt = lambda x: f'${x/1000:.0f}K' if x >= 1000 else f'${x:.0f}'
    label = f'{"-" if sign < 0 else ""}{fmt(lo)}-{fmt(hi)}'
    # sort key: negatives ascend from most-negative, positives ascend from 0
    sort_key = (0, -hi) if sign < 0 else (1, lo)
    return (sort_key, label)


def build_pnl_histogram(users):
    c = Counter()
    labels_by_key = {}
    for u in users:
        b = pnl_bucket(u.get('best_pnl'))
        if b is None:
            continue
        key, label = b
        c[key] += 1
        labels_by_key[key] = label
    ordered_keys = sorted(c.keys())
    return {
        'buckets': [labels_by_key[k] for k in ordered_keys],
        'counts': [c[k] for k in ordered_keys],
    }


def build_pareto(users):
    winners = sorted(
        (u['best_pnl'] for u in users if (u.get('best_pnl') or 0) > 0),
        reverse=True,
    )
    total = sum(winners)
    points = [[0.0, 0.0]]
    running = 0.0
    n = len(winners)
    step = max(1, n // 500)  # cap curve resolution
    for i, v in enumerate(winners):
        running += v
        if i % step == 0 or i == n - 1:
            points.append([round(100 * (i + 1) / n, 3), round(100 * running / total, 3)])
    return {'points': points, 'winner_count': n, 'total_pnl': total}


def build_scatter(users, sample_size=3000):
    rows = []
    for u in users:
        best = u.get('best_pnl')
        if best is None:
            continue
        ctx = u.get('best_pnl_context') or {}
        match = next((r for r in u['rankings'] if r.get('pnl') == best), None)
        if not match:
            continue
        vol = match.get('vol')
        if not vol or vol <= 0:
            continue
        rows.append({'vol': vol, 'pnl': best, 'category': ctx.get('category', 'OVERALL')})

    cat_counts = Counter(r['category'] for r in rows)
    top_cats = [c for c, _ in cat_counts.most_common(7)]
    for r in rows:
        if r['category'] not in top_cats:
            r['category'] = 'Other'

    if len(rows) > sample_size:
        rows = random.sample(rows, sample_size)
    return {'points': rows, 'categories': top_cats + ['Other']}


def build_appearances_histogram(users):
    c = Counter(u['appearances'] for u in users)
    labels, counts = [], []
    for n in range(1, 20):
        labels.append(str(n))
        counts.append(c.get(n, 0))
    tail = sum(v for k, v in c.items() if k >= 20)
    labels.append('20+')
    counts.append(tail)
    return {'buckets': labels, 'counts': counts}


def build_category_data(users):
    cat_wallets = {cat: set() for cat in CATEGORIES}
    for u in users:
        seen = {r['category'] for r in u['rankings']}
        for cat in seen:
            if cat in cat_wallets:
                cat_wallets[cat].add(u['wallet'])

    counts = {cat: len(w) for cat, w in cat_wallets.items()}
    ordered = sorted(CATEGORIES, key=lambda c: -counts[c])

    matrix = []
    for a in ordered:
        row = []
        for b in ordered:
            row.append(len(cat_wallets[a] & cat_wallets[b]))
        matrix.append(row)

    return (
        {'categories': ordered, 'counts': [counts[c] for c in ordered]},
        {'categories': ordered, 'matrix': matrix},
    )


def build_verified_comparison(users):
    def summarize(group):
        vals = [u['best_pnl'] for u in group if u.get('best_pnl') is not None]
        if not vals:
            return {'count': 0, 'mean': 0, 'median': 0}
        return {'count': len(vals), 'mean': round(stats.mean(vals), 2), 'median': round(stats.median(vals), 2)}

    verified = [u for u in users if u.get('verified')]
    unverified = [u for u in users if not u.get('verified')]
    return {'verified': summarize(verified), 'unverified': summarize(unverified)}


def build_day_vs_all(users, sample_size=2000):
    points = []
    for u in users:
        day = next((r['rank'] for r in u['rankings']
                    if r['category'] == 'OVERALL' and r['timePeriod'] == 'DAY' and r['orderBy'] == 'PNL'), None)
        allt = next((r['rank'] for r in u['rankings']
                     if r['category'] == 'OVERALL' and r['timePeriod'] == 'ALL' and r['orderBy'] == 'PNL'), None)
        if day is not None and allt is not None:
            points.append([day, allt])
    if len(points) > sample_size:
        points = random.sample(points, sample_size)
    return {'points': points}


def build_word_freq(users, top_n=40):
    words = Counter()
    for u in users:
        name = u.get('username')
        if not name or ADDR_RE.match(name.replace('-', '')[:42]) or name.isdigit():
            continue
        for tok in re.split(r'[^a-zA-Z]+', name):
            tok = tok.lower()
            if len(tok) >= 3:
                words[tok] += 1
    common = words.most_common(top_n)
    return {'words': [w for w, _ in common], 'counts': [c for _, c in common]}


PERIOD_PRIORITY = ['ALL', 'MONTH', 'WEEK', 'DAY']
MIN_VOL_FOR_EDGE = 1000  # filters out lucky tiny-bet ROI outliers


def build_edge_traders(users, top_n=30):
    """'Real edge' = profitable in every OVERALL/PNL time window we can observe
    them in (not a one-off lucky day), with meaningful capital deployed (not a
    $10 bet that happened to 10x) and real capital efficiency (PnL/volume),
    not just raw volume."""
    candidates = []
    for u in users:
        by_period = {}
        for r in u['rankings']:
            if r['category'] == 'OVERALL' and r['orderBy'] == 'PNL':
                by_period[r['timePeriod']] = r  # de-dupes accidental repeat pages

        periods_present = list(by_period.keys())
        if len(periods_present) < 2:
            continue
        if not all((by_period[p]['pnl'] or 0) > 0 for p in periods_present):
            continue

        basis = next((by_period[p] for p in PERIOD_PRIORITY if p in by_period), None)
        vol, pnl = basis.get('vol'), basis.get('pnl')
        if not vol or vol < MIN_VOL_FOR_EDGE or not pnl:
            continue

        roi = pnl / vol
        candidates.append({
            'wallet': u['wallet'],
            'username': u.get('username') or (u['wallet'][:8] + '…'),
            'roi': roi,
            'pnl': pnl,
            'vol': vol,
            'periods': len(periods_present),
            'basis_period': basis['timePeriod'],
            # weight ROI by how much of the DAY/WEEK/MONTH/ALL window we have
            # positive-PnL evidence for, so one thin-sample lucky longshot
            # doesn't outrank a trader profitable in every window we can see.
            'edge_score': roi * (len(periods_present) / len(PERIOD_PRIORITY)),
        })

    candidates.sort(key=lambda c: -c['edge_score'])
    return {'traders': candidates[:top_n], 'candidate_pool_size': len(candidates)}


def build_strategy_comparison(sweep_path='strategy_sweep.json', split_path='strategy_sweep_single_split.json'):
    """Pulls in the offline strategy-sweep.py outputs (rolling pool-size sweep +
    single-split threshold sweep) to show: (1) narrow trader pools are unreliable
    (wide win-rate spread) vs broad pools, and (2) the win-rate/return tradeoff
    across consensus thresholds, cross-checked against the walk-forward numbers
    already in the dashboard."""
    result = {'pool_size_spread': None, 'single_split': None}

    try:
        sweep = json.load(open(sweep_path))
    except FileNotFoundError:
        sweep = None
    if sweep:
        by_top_k = defaultdict(list)
        for r in sweep:
            by_top_k[r['top_k']].append(r['threshold_1']['win_rate'])
        spread = []
        for tk in sorted(by_top_k.keys()):
            vals = sorted(by_top_k[tk])
            spread.append({'top_k': tk, 'min': vals[0], 'median': vals[len(vals) // 2], 'max': vals[-1]})
        result['pool_size_spread'] = spread

    try:
        split = json.load(open(split_path))
    except FileNotFoundError:
        split = None
    if split:
        candidates = [r for r in split if r['top_k'] == 250 and r['metric'] == 'pnl']
        if candidates:
            best = max(candidates, key=lambda r: r['train_frac'])  # prefer the split with the most test data
            thresholds = []
            for t in [1, 2, 3, 5, 10]:
                s = best['thresholds'].get(str(t), {'signal_count': 0, 'win_rate': 0, 'mean_return': 0})
                thresholds.append({'threshold': t, **s})
            result['single_split'] = {'train_frac': best['train_frac'], 'top_k': best['top_k'], 'thresholds': thresholds}
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--users', default='polymarket_users.json')
    ap.add_argument('--backtest', default='backtest_results.json')
    ap.add_argument('--walkforward', default='walkforward_results.json')
    ap.add_argument('--out', default='polymarket_dashboard.html')
    args = ap.parse_args()

    print(f'Loading {args.users}...')
    users = json.load(open(args.users))
    print(f'{len(users)} users loaded. Aggregating...')

    category_counts, cooccurrence = build_category_data(users)

    viz = {
        'meta': {'total_users': len(users)},
        'pnl_histogram': build_pnl_histogram(users),
        'pareto': build_pareto(users),
        'scatter': build_scatter(users),
        'appearances_histogram': build_appearances_histogram(users),
        'category_counts': category_counts,
        'cooccurrence': cooccurrence,
        'verified': build_verified_comparison(users),
        'day_vs_all': build_day_vs_all(users),
        'word_freq': build_word_freq(users),
        'edge_traders': build_edge_traders(users),
        'backtest': None,
        'walkforward': None,
        'strategy_comparison': build_strategy_comparison(),
    }

    try:
        viz['backtest'] = json.load(open(args.backtest))
        print(f'Included backtest results from {args.backtest}')
    except FileNotFoundError:
        print(f'No {args.backtest} found yet — dashboard will skip the backtest section.')

    try:
        viz['walkforward'] = json.load(open(args.walkforward))
        print(f'Included walk-forward results from {args.walkforward}')
    except FileNotFoundError:
        print(f'No {args.walkforward} found yet — dashboard will skip the walk-forward comparison.')

    print('Rendering HTML...')
    data_json = json.dumps(viz).replace('</', '<\\/')

    from pathlib import Path
    template = Path(__file__).with_name('dashboard_template.html').read_text()
    html = template.replace('__VIZ_DATA__', data_json)

    Path(args.out).write_text(html)
    print(f'Wrote {args.out} ({len(html) // 1024} KB)')


if __name__ == '__main__':
    main()
