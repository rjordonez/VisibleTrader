#!/usr/bin/env bash
# Daily refresh of wallet_directory's recent-activity data (recent_pnl /
# recent_rank_seen) — see live-signal-service.py's build_roster() for why
# this needs to run periodically instead of once. best_pnl barely moves
# day to day, but the DAY/WEEK leaderboard data backing the "active"
# roster bucket goes stale within a day or two without a fresh scrape.
#
# flock prevents two runs overlapping if one takes longer than usual.
# Contention-tested against production on 2026-09-15: a full run briefly
# pushed load above this box's CPU capacity (peak 3.39 on 2 vCPUs) but
# caused no request failures or WebSocket timeouts — schedule for a
# low-traffic window as a safety margin, not because it's known to break.
set -euo pipefail
cd "$(dirname "$0")/.."

exec 200>/tmp/wallet_directory_sync.lock
flock -n 200 || { echo "$(date -u +%FT%TZ) already running, skipping"; exit 0; }

set -a
source .env
set +a

TS=$(date -u +%Y%m%d_%H%M%S)
SCRAPE_FILE="/tmp/polymarket_users_${TS}.json"

echo "$(date -u +%FT%TZ) starting scrape -> $SCRAPE_FILE"
venv/bin/python3 scripts/scrape-polymarket-users.py --out "$SCRAPE_FILE"

echo "$(date -u +%FT%TZ) starting sync"
venv/bin/python3 scripts/sync_wallet_directory.py --users "$SCRAPE_FILE" --database-url "$DATABASE_URL"

rm -f "$SCRAPE_FILE"
echo "$(date -u +%FT%TZ) done"
