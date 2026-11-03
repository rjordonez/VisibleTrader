"""Insider-pattern discovery from Polymarket's public Data API v2 + Gamma.

Pure HTTP + scoring, no database: live-signal-service.py calls these and
writes the results (insider_hits / insider_wallets / insider_alerts, see
supabase/migrations/20261103030000_insider_discovery.sql). Kept separate so
the scoring can be run and checked against live data on its own:

    python3 scripts/insider_scan.py hits    # resolved long-shot wins
    python3 scripts/insider_scan.py alerts  # open long-shot bets right now

"Insider pattern" is a pattern, not proof: a long-shot win outside sports,
weighted toward bets placed shortly before the result and wallets with
little or no history. Scores are 0-100; PATTERN_SCORE and up is listed.
"""
import json, re, time, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

UA = {'User-Agent': 'Mozilla/5.0'}
DATA = 'https://data-api.polymarket.com/v2'
GAMMA = 'https://gamma-api.polymarket.com'

# biggest-winners categories where a leak can move the outcome. Sports,
# esports, weather and crypto price markets are left out on purpose.
HIT_CATEGORIES = ['politics', 'economics', 'tech', 'culture', 'mentions']
# Gamma tag slugs for the live scan (Gamma's taxonomy differs from
# biggest-winners'; finance there is mostly price-target markets).
ALERT_TAGS = ['politics', 'geopolitics', 'world', 'economy', 'tech']
# Count markets ("Elon Musk # tweets ...") pay 10x+ by construction: dozens
# of buckets, one wins. Short-dated price markets ("TSLA Up or Down", "WTI
# hit ...", "Market Cap") reward buying cheap into the close: trading, not
# information. Neither is listed.
EXCLUDE_TITLE = re.compile(
    r'tweets?|# of |up or down|\bhit\b|above|below|\bprice\b|market cap|\bclose\b|closing|\(\w{1,5}\)', re.I)
# A wallet with thousands of markets is a strategy or a bot, whatever one
# bet looks like.
MAX_PATTERN_TRADES = 2000

MIN_MULTIPLIER = 5       # paid 5x+ = bought at 20% or less
MIN_HIT_PNL = 10_000
MIN_ALERT_COST = 5_000
MAX_ALERT_PRICE = 0.20
# Leaks happen close to the event: a 2028 long shot is a fan bet, not a tip.
MAX_ALERT_DAYS = 21
PATTERN_SCORE = 50


def get(url, timeout=20):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.load(r)


def pages(path, params, max_pages=10):
    """Rows from a v2 cursor-paged endpoint."""
    rows, cursor = [], None
    for _ in range(max_pages):
        q = f'cursor={urllib.parse.quote(cursor)}' if cursor else urllib.parse.urlencode(params)
        body = get(f'{DATA}{path}?{q}')
        rows += body.get('data') or []
        cursor = (body.get('pagination') or {}).get('next_cursor')
        if not cursor:
            break
    return rows


def wallet_stats(wallet):
    """(trades, join_date epoch or None) — distinct markets traded and when
    the account first appeared."""
    d = get(f'{DATA}/user-stats?user={wallet}').get('data') or {}
    return int(d.get('trades') or 0), d.get('join_date')


def buy_timing(wallet, condition_id):
    """(first buy epoch, dollar-weighted average buy epoch) on one market,
    or (None, None) when the feed has no buys for it."""
    acts = pages('/activity', {'user': wallet, 'condition': condition_id, 'type': 'TRADE',
                               'side': 'BUY', 'limit': 500}, max_pages=4)
    acts = [a for a in acts if a.get('timestamp')]
    if not acts:
        return None, None
    total = sum(float(a.get('usdc_size') or 0) for a in acts)
    first = min(a['timestamp'] for a in acts)
    if total <= 0:
        return first, first
    return first, sum(a['timestamp'] * float(a.get('usdc_size') or 0) for a in acts) / total


def _epoch(iso):
    if not iso:
        return None
    try:
        from datetime import datetime
        return datetime.fromisoformat(iso.replace('Z', '+00:00')).timestamp()
    except ValueError:
        return None


def odds_points(p):
    return 35 if p <= 0.05 else 25 if p <= 0.10 else 15 if p <= 0.20 else 0


def fresh_points(trades, join_date, bet_ts):
    pts = 20 if trades <= 25 else 10 if trades <= 100 else 0
    if join_date and bet_ts and bet_ts - join_date <= 30 * 86400:
        pts = 20  # account opened within 30 days of the bet
    return pts


def size_points(usd):
    return 10 if usd >= 100_000 else 6 if usd >= 25_000 else 3 if usd >= 10_000 else 0


def score_hit(entry_odds, hours_before, trades, join_date, bet_ts, initial):
    timing = 0
    if hours_before is not None:
        timing = 35 if hours_before <= 24 else 25 if hours_before <= 72 else 12 if hours_before <= 168 else 0
    return odds_points(entry_odds) + timing + fresh_points(trades, join_date, bet_ts) + size_points(initial)


def score_alert(avg_price, trades, join_date, now, cost, days_to_end):
    # Same scale as hits; how close the market is to resolving stands in for
    # how close to the result the bet was placed.
    timing = 35 if days_to_end <= 3 else 25 if days_to_end <= 7 else 12
    return odds_points(avg_price) + timing + fresh_points(trades, join_date, now) + size_points(cost)


def winner_candidates(windows):
    """Resolved long-shot wins (5x+, $10k+ profit) outside sports, newest
    windows first. One row per winning position."""
    seen, out = set(), []
    for window in windows:
        for cat in HIT_CATEGORIES:
            for r in pages('/biggest-winners', {'time_period': window, 'category': cat, 'limit': 500}, max_pages=2):
                init, final = float(r.get('initial_value') or 0), float(r.get('final_value') or 0)
                key = (r.get('user_id'), r.get('position_id'))
                if (r.get('kind') != 'market' or init < 1000 or final <= 0 or final / init < MIN_MULTIPLIER
                        or float(r.get('pnl') or 0) < MIN_HIT_PNL or EXCLUDE_TITLE.search(r.get('event_title') or '')
                        or key in seen):
                    continue
                seen.add(key)
                out.append({**r, 'category': cat})
    return out


def enrich_hit(r, stats):
    """Adds timing and score to a biggest-winners row. `stats` is
    {wallet: (trades, join_date)}."""
    wallet = r['user_id']
    trades, join_date = stats.get(wallet, (0, None))
    first, wavg = buy_timing(wallet, r['condition_id'])
    entry_odds = float(r['initial_value']) / float(r['final_value'])
    hours_before = (r['resolved_at'] - wavg) / 3600 if wavg else None
    score = score_hit(entry_odds, hours_before, trades, join_date, first, float(r['initial_value']))
    return {
        'wallet': wallet, 'wallet_name': r.get('user_name') or None, 'position_id': r['position_id'],
        'condition_id': r['condition_id'], 'event_title': r.get('event_title') or '', 'event_slug': r.get('event_slug') or '',
        'category': r['category'], 'initial_value': float(r['initial_value']), 'final_value': float(r['final_value']),
        'pnl': float(r['pnl']), 'entry_odds': entry_odds, 'multiplier': float(r['final_value']) / float(r['initial_value']),
        'resolved_at': r['resolved_at'], 'first_buy_at': first,
        'buy_hours_before': round(hours_before, 1) if hours_before is not None else None,
        # Long odds and size alone describe a public election whale too: it
        # also needs to be bought close to the result or from a wallet with
        # little history.
        'score': score,
        'is_pattern': (score >= PATTERN_SCORE and trades <= MAX_PATTERN_TRADES
                       and ((hours_before is not None and hours_before <= 168) or fresh_points(trades, join_date, first) >= 20)),
    }


def live_longshot_markets(max_markets=120, events_per_tag=50):
    """Open markets outside sports with an outcome priced 2-20%: [(market,
    {token_id: (outcome, price)})], busiest first."""
    out, seen = [], set()
    for tag in ALERT_TAGS:
        events = get(f'{GAMMA}/events?tag_slug={tag}&active=true&closed=false&order=volume24hr&ascending=false&limit={events_per_tag}')
        for e in events or []:
            for m in e.get('markets') or []:
                cid = m.get('conditionId')
                if not cid or cid in seen or not m.get('acceptingOrders') or m.get('closed'):
                    continue
                end = _epoch(m.get('endDate') or e.get('endDate'))
                if not end or not 0 <= end - time.time() <= MAX_ALERT_DAYS * 86400:
                    continue
                try:
                    outcomes, prices, tokens = (json.loads(m[k]) if isinstance(m.get(k), str) else m.get(k)
                                                for k in ('outcomes', 'outcomePrices', 'clobTokenIds'))
                except (TypeError, ValueError, KeyError):
                    continue
                if not outcomes or not prices or not tokens:
                    continue
                longshots = {t: (o, float(p)) for o, p, t in zip(outcomes, prices, tokens) if 0.02 <= float(p) <= MAX_ALERT_PRICE}
                if not longshots or EXCLUDE_TITLE.search(m.get('question') or ''):
                    continue
                seen.add(cid)
                out.append(({'condition_id': cid, 'question': m.get('question') or '', 'event_title': e.get('title') or '',
                             'event_slug': e.get('slug') or '', 'category': tag, 'end_date': end}, longshots))
    return out[:max_markets]  # Gamma's per-tag volume order


def longshot_holders(market, longshots, limit=25):
    """Holders of a market's long-shot outcomes who put $5k+ in at 20% or
    less."""
    body = get(f"{DATA}/holders?condition={market['condition_id']}&include_pnl=true&limit={limit}")
    rows = []
    for group in body.get('data') or []:
        token = group.get('token_id')
        if token not in longshots:
            continue
        outcome, price = longshots[token]
        for h in group.get('holders') or []:
            cost, avg = float(h.get('entry_cost_usdc') or 0), h.get('avg_price')
            if cost < MIN_ALERT_COST or avg is None or float(avg) > MAX_ALERT_PRICE:
                continue
            rows.append({**market, 'wallet': h['proxy_wallet'].lower(),
                         'wallet_name': h.get('name') or h.get('pseudonym') or None,
                         'token_id': token, 'outcome': outcome, 'entry_cost': cost, 'avg_price': float(avg),
                         'current_price': float(h.get('current_price') or price),
                         'current_value': float(h.get('current_value') or 0)})
    return rows


def stats_for(wallets, cached=None, workers=6):
    """{wallet: (trades, join_date)}, fetching only wallets not in `cached`."""
    cached = dict(cached or {})
    missing = [w for w in wallets if w not in cached]

    def one(w):
        try:
            return w, wallet_stats(w)
        except Exception:
            return w, None
    with ThreadPoolExecutor(max_workers=workers) as pool:
        for w, s in pool.map(one, missing):
            if s:
                cached[w] = s
    return cached


def scan_hits(windows, known=frozenset(), stats_cache=None, workers=6):
    """New insider-pattern hit rows (all scored; caller keeps the scores)."""
    cands = [r for r in winner_candidates(windows) if (r['user_id'], r['position_id']) not in known]
    stats = stats_for({r['user_id'] for r in cands}, stats_cache, workers)

    def one(r):
        try:
            return enrich_hit(r, stats)
        except Exception:
            return None
    with ThreadPoolExecutor(max_workers=workers) as pool:
        hits = [h for h in pool.map(one, cands) if h]
    return hits, stats


def scan_alerts(stats_cache=None, workers=6, max_markets=120):
    """Open long-shot bets by fresh or thin-history wallets, scored."""
    markets = live_longshot_markets(max_markets)

    def one(m):
        try:
            return longshot_holders(*m)
        except Exception:
            return []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        rows = [r for batch in pool.map(one, markets) for r in batch]
    stats = stats_for({r['wallet'] for r in rows}, stats_cache, workers)
    now = time.time()
    alerts = []
    for r in rows:
        trades, join_date = stats.get(r['wallet'], (10**6, None))
        fresh = trades <= 50 or bool(join_date and now - join_date <= 30 * 86400)
        if not fresh:
            continue
        days = (r['end_date'] - now) / 86400
        score = score_alert(r['avg_price'], trades, join_date, now, r['entry_cost'], days)
        if score >= PATTERN_SCORE:
            alerts.append({**r, 'score': score})
    return alerts, stats, len(markets)


if __name__ == '__main__':
    import sys
    mode = sys.argv[1] if len(sys.argv) > 1 else 'hits'
    t = time.time()
    if mode == 'alerts':
        alerts, stats, n = scan_alerts()
        print(f'{len(alerts)} alerts from {n} markets in {time.time() - t:.0f}s')
        for a in sorted(alerts, key=lambda a: -a['score'])[:20]:
            tr, jd = stats.get(a['wallet'], (None, None))
            print(f"  {a['score']:3d}  ${a['entry_cost']/1e3:6.1f}k @ {a['avg_price']*100:4.1f}% (now {a['current_price']*100:4.1f}%)  "
                  f"trades={tr}  {(a['wallet_name'] or a['wallet'][:10])[:16]:16}  {a['outcome'][:14]:14} {a['question'][:55]}")
    else:
        hits, stats = scan_hits(sys.argv[2:] or ['all', 'month'])
        pattern = [h for h in hits if h['is_pattern']]
        print(f'{len(hits)} hits, {len(pattern)} insider-pattern, {len(stats)} wallets in {time.time() - t:.0f}s')
        for h in sorted(pattern, key=lambda h: -h['score'])[:25]:
            tr, jd = stats.get(h['wallet'], (None, None))
            print(f"  {h['score']:3d}  {h['multiplier']:5.1f}x ${h['initial_value']/1e3:6.1f}k->${h['final_value']/1e3:7.1f}k  "
                  f"{h['buy_hours_before'] if h['buy_hours_before'] is not None else '?':>7}h  trades={tr}  "
                  f"{(h['wallet_name'] or h['wallet'][:10])[:16]:16} {h['event_title'][:50]}")
