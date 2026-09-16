#!/usr/bin/env bash
# Entrypoint for the wallet-directory-sync Cloud Run Job. Runs on its own
# isolated container — no shared memory with live-signal-service, unlike
# the VM-based cron this replaces (which crashed live-signal-service twice
# via memory pressure during testing on 2026-09-15).
set -euo pipefail

SCRAPE_FILE="/tmp/polymarket_users.json"

echo "$(date -u +%FT%TZ) starting scrape"
python3 scripts/scrape-polymarket-users.py --out "$SCRAPE_FILE"

echo "$(date -u +%FT%TZ) starting sync"
python3 scripts/sync_wallet_directory.py --users "$SCRAPE_FILE" --database-url "$DATABASE_URL"

echo "$(date -u +%FT%TZ) done"
