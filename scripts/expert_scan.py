"""Expert discovery from Polymarket's public Data API v2.

The Leaderboard's Experts view used to come from trader_scores, i.e. only
the wallets already on our roster. This scores wallets from anywhere on
Polymarket: candidates come from Polymarket's own P&L boards, then each is
judged on its closed positions, one row per market. live-signal-service.py
writes the results to expert_traders (see
supabase/migrations/20261103040000_expert_discovery.sql).

    python3 scripts/expert_scan.py      # score candidates and print the top

Expert = consistently profitable per market, not one big score:
  * MIN_POSITIONS+ closed positions of MIN_POSITION_COST+ each,
  * MIN_ROI+ return on everything staked and MIN_PNL+ profit, both on these
    positions and all-time by Polymarket's own count,
  * t-statistic of per-position returns >= MIN_T (each position's return is
    capped at RETURN_CAP so a single 50x long shot can't carry it).
Returns rather than "beat the odds": v2 closed rows don't say whether a
position was sold or held to resolution, but P&L per dollar staked is
exact either way.
"""
import math, time
from concurrent.futures import ThreadPoolExecutor
from insider_scan import pages, wallet_stats

BOARD_CATEGORIES = ['overall', 'politics', 'sports', 'esports', 'crypto', 'economics', 'tech', 'culture', 'finance']
BOARD_DEPTH = 200          # wallets per board
MIN_BOARD_ROI = 0.02       # P&L / volume; drops market makers and volume bots before any per-wallet calls
MIN_POSITIONS = 50
MIN_POSITION_COST = 50
MIN_ROI = 0.05
MIN_T = 2.0
MIN_PNL = 25_000           # consistent but tiny ($1-3k) isn't worth following
RETURN_CAP = 5.0
MAX_POSITIONS = 3000       # most recent per status; enough for a stable estimate
CLOSED_STATUSES = ['CLOSED', 'REDEEMABLE', 'REDEEMABLE_LOST']


def candidates(windows=('all', 'month')):
    """{wallet: name} from Polymarket's P&L boards, minus volume bots."""
    out = {}
    for window in windows:
        for cat in BOARD_CATEGORIES:
            for r in pages('/leaderboard', {'time_period': window, 'category': cat, 'sort_by': 'PNL', 'limit': BOARD_DEPTH}, max_pages=1):
                pnl, vol = float(r.get('pnl') or 0), float(r.get('volume') or 0)
                if pnl > 0 and vol > 0 and pnl / vol >= MIN_BOARD_ROI:
                    out.setdefault(r['user_id'].lower(), r.get('user_name') or None)
    return out


def closed_positions(wallet):
    rows = []
    for status in CLOSED_STATUSES:
        rows += pages('/positions', {'user': wallet, 'status': status, 'limit': 1000, 'sort_by': 'TIMESTAMP'},
                      max_pages=MAX_POSITIONS // 1000)
    return rows


def score_wallet(wallet, name=None):
    """Expert stats for one wallet, or None if it has too little history."""
    rows = closed_positions(wallet)
    pos = []
    for p in rows:
        cost = float(p.get('total_size') or 0) * float(p.get('avg_price') or 0)
        if cost < MIN_POSITION_COST:
            continue
        pos.append((cost, float(p.get('total_pnl') or 0), float(p.get('avg_price') or 0)))
    n = len(pos)
    if n < MIN_POSITIONS:
        return None
    cost = sum(c for c, _, _ in pos)
    pnl = sum(x for _, x, _ in pos)
    rets = [min(x / c, RETURN_CAP) for c, x, _ in pos]
    mean = sum(rets) / n
    sd = math.sqrt(sum((r - mean) ** 2 for r in rets) / (n - 1)) if n > 1 else 0
    t = mean / (sd / math.sqrt(n)) if sd > 0 else 0
    wins = sum(1 for _, x, _ in pos if x > 0)
    roi = pnl / cost if cost else 0
    # The positions above are the most recent MAX_POSITIONS per status;
    # Polymarket's own all-time number decides whether they're really up.
    _, _, all_time = wallet_stats(wallet)
    return {
        'wallet': wallet, 'wallet_name': name, 'positions': n, 'wins': wins, 'win_rate': wins / n,
        'cost': cost, 'pnl': pnl, 'roi': roi, 't_stat': t,
        'avg_odds': sum(c * p for c, _, p in pos) / cost if cost else 0,
        'all_time_pnl': all_time,
        'is_expert': pnl >= MIN_PNL and all_time >= MIN_PNL and roi >= MIN_ROI and t >= MIN_T,
    }


def scan_experts(workers=6, windows=('all', 'month')):
    cands = candidates(windows)

    def one(item):
        try:
            return score_wallet(*item)
        except Exception:
            return None
    with ThreadPoolExecutor(max_workers=workers) as pool:
        scored = [s for s in pool.map(one, cands.items()) if s]
    return scored, len(cands)


if __name__ == '__main__':
    t0 = time.time()
    scored, n = scan_experts()
    experts = sorted([s for s in scored if s['is_expert']], key=lambda s: -s['pnl'])
    print(f'{n} candidates, {len(scored)} with 50+ markets, {len(experts)} experts in {time.time() - t0:.0f}s')
    for s in experts[:25]:
        print(f"  t={s['t_stat']:5.1f}  {s['positions']:5d} mkts  win {s['win_rate']*100:4.0f}%  ROI {s['roi']*100:+5.0f}%  "
              f"P&L ${s['pnl']/1e3:8.0f}k  odds {s['avg_odds']*100:3.0f}%  {(s['wallet_name'] or s['wallet'][:10])[:20]}")
