#!/usr/bin/env python3
"""Live signal-detection backend: watches real-time Polymarket trades via
WebSocket, resolves each trade's on-chain sender wallet, and surfaces
capital-weighted-conviction opportunities from a tracked roster of top
traders into a Supabase Postgres DB for a future UI to read. Schema lives in
supabase/migrations/*.sql, applied via Supabase's GitHub integration — this
file only connects and writes, it never creates or alters tables.

Long-running process — run with `python3 scripts/live-signal-service.py` and
leave it going. Requires DATABASE_URL in the environment (Supabase Settings
> Database > Connection string). Uses the raw-socket WebSocket client
pattern validated live earlier this session; the only non-stdlib dependency
is psycopg for the Postgres connection.
"""
import argparse, bisect, json, os, socket, ssl, struct, base64, threading, time, urllib.error, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from _env import load_env

WS_HOST = 'ws-subscriptions-clob.polymarket.com'
WS_PATH = '/ws/market'
RPC_PROVIDERS = [
    'https://polygon-bor-rpc.publicnode.com',
    'https://1rpc.io/matic',
    'https://polygon.drpc.org',
]
# Polymarket's collateral token — USDC.e (bridged USDC), not native USDC —
# verified against Polymarket's own bridge docs, not assumed.
USDC_CONTRACT = '0x2791bca1f2de4661ed88a30c99a7a9449aa84174'
BALANCE_OF_SELECTOR = '0x70a08231'  # balanceOf(address)
BALANCE_REFRESH_SECONDS = 15 * 60
AGGREGATE_REFRESH_SECONDS = 90  # opportunities_live's best_win_rate/best_bet_ratio join — see refresh_opportunity_aggregates()
LEADERBOARD_REFRESH_SECONDS = 120  # leaderboard_cache — see refresh_leaderboard()
WALLET_CATEGORY_REFRESH_SECONDS = 180  # wallet_category_breakdown_cache — see refresh_wallet_category_breakdown()
WARM_SEARCH_SECONDS = 4 * 60  # keeps the wallet-search Edge Function's isolate warm — see ping_wallet_search()
BROADCAST_INTERVAL_SECONDS = 5  # batches opportunities/ticker changes into one Realtime broadcast per window —
# see flush_dirty_broadcast(). Replaces per-row postgres_changes delivery on these two tables, which was blowing
# through the Realtime message quota (~1,400 tracked markets ticking individually) despite barely any real users.
ROSTER_SIZE = 500
TIERS = [1000, 5000, 20000, 50000, 100000]
SOLO_TIER = 0  # sentinel: first tracked-trader entry into a market, fires immediately (keeps the feed active between rarer multi-wallet tier crossings)
CONVICTION_WINDOW_SECONDS = 48 * 3600
MARKET_REFRESH_SECONDS = 15 * 60
HEARTBEAT_SECONDS = 30
TICKER_MIN_USD = 100  # any trade this size or bigger, from ANY wallet, shows on the ticker instantly (no RPC wait).
# Measured live: $500 only nets ~1 qualifying trade/5s even in the busiest markets (4% of trades sampled),
# too slow for a <=5s feed once diluted across all ~4,200 active markets. $100 measured ~15% of trades,
# roughly 1/1.3s in busy markets — real margin under the 5s target.
TICKER_RETENTION_SECONDS = 2 * 3600  # ticker is high-volume by design — prune old rows so the table stays bounded
SCALP_WINDOW_SECONDS = 30 * 60  # a roster wallet's buy->sell round trip inside this window reads as a fast scalp, not a considered directional hold
UA = {'User-Agent': 'Mozilla/5.0'}
KNOWN_CATEGORY_SLUGS = {
    'politics', 'sports', 'esports', 'crypto', 'culture',
    'mentions', 'weather', 'economics', 'tech', 'finance',
}  # Polymarket's own top-level taxonomy (same list the leaderboard scraper uses)

load_env()
if 'vohtqodprqpobvvcdypy' in os.environ.get('DATABASE_URL', ''):
    print('⚠️  DATABASE_URL points at PRODUCTION — if this is running on your own machine (not the VM), that is almost certainly wrong. Ctrl+C now if so.')

state_lock = threading.Lock()  # guards in-memory state only (stats/conviction/tiers_hit/
# resolved_markets/roster_set) — DB writes go through Database's connection pool, which
# lets Postgres's own MVCC handle write concurrency instead of serializing through Python.
stats = {'trades_seen': 0, 'roster_matches': 0, 'rpc_failures': 0, 'ticker_trades': 0,
         # Diagnostic-only counters (2026-08-26) — trades_seen only counts
         # last_trade_price, so a connection silently getting price_change
         # but not last_trade_price looked identical to "no messages at
         # all" from the heartbeat alone. These make that distinction
         # visible without needing an external probe script.
         'price_change_seen': 0, 'book_seen': 0, 'other_events_seen': 0,
         # Realtime-quota diagnostic (2026-09) — old_message_estimate counts
         # what postgres_changes would have sent under the pre-broadcast
         # design (one message per dirty-mark per old subscriber: 3 for
         # opportunities, HomePage+Terminal+SignalsDemo; 1 for ticker,
         # which only ever had one subscriber). broadcast_sends counts what
         # actually goes out now. The ratio between them, measured against
         # this same run's real traffic, is the real reduction — no need
         # to wait on production quota numbers to see it.
         'old_message_estimate': 0, 'broadcast_sends': 0,
         # Timing diagnostics (2026-08-26) — added to find where a
         # process_trade call actually spends its time under real on-chain
         # volume, instead of guessing at pool/worker sizes again. All in
         # milliseconds; heartbeat reports count + average.
         'profile_fetch_count': 0, 'profile_fetch_ms': 0.0, 'profile_fetch_cache_hits': 0,
         'process_trade_count': 0, 'process_trade_ms': 0.0, 'process_trade_submitted': 0}

# Updated once per inner listen-loop tick (see main()) as proof the event loop is
# still alive. watchdog() below is a last-resort safety net independent of any
# specific bug — if something we haven't anticipated blocks forever anywhere in
# the connect/listen path, this notices and force-exits so systemd (Restart=always,
# see live-signal-service.service) brings us back up clean, instead of the process
# sitting "active" but silently dead until someone happens to check.
last_activity = {'ts': time.time()}


def watchdog(threshold_seconds=180):
    while True:
        time.sleep(30)
        stale_for = time.time() - last_activity['ts']
        if stale_for > threshold_seconds:
            print(f'[watchdog] no activity in {stale_for:.0f}s (> {threshold_seconds}s) — exiting so systemd restarts us.')
            os._exit(1)
conviction = defaultdict(list)  # (conditionId, outcome) -> [(ts, wallet, usd, price), ...]
tiers_hit = defaultdict(set)    # (conditionId, outcome) -> {tiers already recorded}
resolved_markets = set()        # (conditionId, outcome) already resolved — mark-to-market writes
                                 # must never touch these again, or a late/delayed WS tick from
                                 # right before the market closed can silently overwrite the
                                 # snapped-to-final price with a stale mid-market quote.
event_categories = {}           # eventId -> category slug, cached (an /events/{id} call per market is too expensive to do for the whole active-token universe up front)
# wallet -> name-or-None, cached (2026-08-26) — fetch_live_profile_name had
# no caching at all, unlike event_categories above. Under the on-chain
# pipeline's real volume, the same hyperactive wallet (e.g. a scalper firing
# 8+ trades in a few seconds) was triggering a fresh, uncached network call
# on every single one — confirmed live as a major contributor to the
# processing backlog. None is cached too (a wallet with no profile stays
# "no profile" — Polymarket profiles don't appear mid-session), so a wallet
# that's genuinely nameless only ever costs one real request, not one per trade.
live_profile_cache = {}


# ---------------- HTTP helpers ----------------

def get_json(url, retries=3):
    req = urllib.request.Request(url, headers=UA)
    for attempt in range(retries):
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                return json.load(r)
        except Exception:
            if attempt == retries - 1:
                return None
            time.sleep(0.5)


def resolve_tx_sender(tx_hash, retries=3, retry_delay=1.5):
    """A trade just delivered over the WebSocket may not be queryable on any
    RPC node yet (propagation/indexing lag is real, even if usually brief) —
    so 'not found on this provider' must fall through to the next provider,
    and 'not found on ALL providers' gets a short retry before giving up."""
    body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'eth_getTransactionByHash', 'params': [tx_hash]}).encode()
    for attempt in range(retries):
        for rpc in RPC_PROVIDERS:
            try:
                req = urllib.request.Request(rpc, data=body, headers={'Content-Type': 'application/json', **UA})
                with urllib.request.urlopen(req, timeout=8) as r:
                    res = json.load(r)
                result = res.get('result')
                if result and result.get('from'):
                    return result['from'].lower()
                if os.environ.get('LSS_DEBUG'):
                    print(f'  [debug] {rpc} attempt {attempt}: no result for {tx_hash} -> {res}')
            except Exception as e:
                if os.environ.get('LSS_DEBUG'):
                    print(f'  [debug] {rpc} attempt {attempt}: EXCEPTION {type(e).__name__}: {e}')
                continue
        if attempt < retries - 1:
            time.sleep(retry_delay)
    with state_lock:
        stats['rpc_failures'] += 1
    return None


# OrderFilled(bytes32 orderHash, address maker, address taker, uint8 side, uint256 tokenId,
# uint256 makerAmountFilled, uint256 takerAmountFilled, uint256 fee, bytes32 builder, bytes32 metadata)
# — verified live against PolygonScan's decoded ABI for Polymarket's Neg Risk CTF Exchange V2
# (0xe2222d279d744050d28e00520010520000310f59) and cross-checked by decoding a real receipt.
ORDER_FILLED_TOPIC = '0xd543adfd945773f1a62f74f0ee55a5e3b9b1a28262980ba90b1a89f2ea84d8ee'


def _decode_order_filled(log):
    maker = '0x' + log['topics'][2][-40:]
    taker = '0x' + log['topics'][3][-40:]
    data = log['data'][2:]
    words = [data[i:i + 64] for i in range(0, len(data), 64)]
    side = int(words[0], 16)  # 0 = maker's order was a BUY, 1 = maker's order was a SELL
    token_id = int(words[1], 16)
    return {'maker': maker.lower(), 'taker': taker.lower(), 'side': side, 'token_id': token_id}


def resolve_trade_wallet(tx_hash, tid, retries=3, retry_delay=1.5):
    """Resolve the wallet that actually bought, by reading OrderFilled logs in the
    tx receipt and matching on tokenId — NOT by trusting tx.from. Confirmed live: for
    batched/relayed settlement transactions (common on Polymarket), tx.from is the
    relayer/operator that submitted the tx, not any real trader — resolve_tx_sender
    alone silently mis-attributes those trades. Falls back to tx.from when the receipt
    has no matching OrderFilled log (e.g. a genuinely simple direct-EOA transaction, or
    an older exchange contract with a different event shape we haven't mapped)."""
    try:
        target_token = int(tid)
    except (TypeError, ValueError):
        target_token = None

    body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': 'eth_getTransactionReceipt', 'params': [tx_hash]}).encode()
    got_receipt = False
    for attempt in range(retries):
        for rpc in RPC_PROVIDERS:
            try:
                req = urllib.request.Request(rpc, data=body, headers={'Content-Type': 'application/json', **UA})
                with urllib.request.urlopen(req, timeout=8) as r:
                    res = json.load(r)
                result = res.get('result')
                if result is None:
                    if os.environ.get('LSS_DEBUG'):
                        print(f'  [debug] {rpc} attempt {attempt}: no receipt yet for {tx_hash}')
                    continue
                got_receipt = True
                matches = []
                for lg in result.get('logs', []):
                    topics = lg.get('topics') or []
                    if len(topics) == 4 and topics[0] == ORDER_FILLED_TOPIC:
                        try:
                            matches.append(_decode_order_filled(lg))
                        except Exception:
                            continue
                if target_token is not None:
                    token_matches = [m for m in matches if m['token_id'] == target_token]
                    if token_matches:
                        matches = token_matches
                if matches:
                    m = matches[0]
                    return m['maker'] if m['side'] == 0 else m['taker']
                break  # real receipt, just no matching OrderFilled log -> fall back to tx.from
            except Exception as e:
                if os.environ.get('LSS_DEBUG'):
                    print(f'  [debug] {rpc} attempt {attempt}: EXCEPTION {type(e).__name__}: {e}')
                continue
        if got_receipt:
            break
        if attempt < retries - 1:
            time.sleep(retry_delay)

    return resolve_tx_sender(tx_hash, retries=retries, retry_delay=retry_delay)


def fetch_live_profile_name(wallet):
    """Real, documented Polymarket endpoint (gamma-api.polymarket.com/public-profile)
    — a direct profile lookup, not dependent on trade-activity indexing, so it
    works immediately for any wallet with a profile set up regardless of how
    recently they traded. A 404 ('profile not found') is the EXPECTED, common
    outcome (most wallets have no profile) — treated as a clean miss, not
    retried like a transient failure would be, so this doesn't waste 3x
    requests on the common case."""
    req = urllib.request.Request(f'https://gamma-api.polymarket.com/public-profile?address={wallet}', headers=UA)
    try:
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.load(r)
        return data.get('name') or data.get('pseudonym')
    except urllib.error.HTTPError:
        return None  # 404 = no profile, expected and common — not an error to retry
    except Exception:
        return None  # any other failure — skip silently, this is a nice-to-have enrichment


def fetch_event_category(event_id):
    """Market category isn't on the /markets/keyset object — it only lives on the
    parent event (gamma-api.polymarket.com/events/{id} -> tags[]). Fetching that for
    every active token up front (~20-30K) isn't viable, so this is called lazily —
    only for markets that actually produce a ticker/opportunity row — and cached by
    event_id so a repeat market is free. Returns a known category slug or 'other'."""
    if not event_id:
        return 'other'
    if event_id in event_categories:
        return event_categories[event_id]
    category = 'other'
    try:
        req = urllib.request.Request(f'https://gamma-api.polymarket.com/events/{event_id}', headers=UA)
        with urllib.request.urlopen(req, timeout=8) as r:
            data = json.load(r)
        for tag in data.get('tags') or []:
            slug = (tag.get('slug') or '').lower()
            if slug in KNOWN_CATEGORY_SLUGS:
                category = slug
                break
    except Exception:
        pass  # leave it as 'other' — a nice-to-have enrichment, not worth retrying
    event_categories[event_id] = category
    return category


# ---------------- roster ----------------

def load_all_users(db):
    """Wallet roster data — pulled from wallet_directory (Supabase) instead
    of the local polymarket_users.json file. That file is ~240MB raw, which
    parses into well over 1GB of Python objects once loaded — too much for
    a 1GB-RAM box, and the actual cause of a VM going unresponsive under
    memory pressure. wallet_directory already holds the same data (synced by
    scripts/sync_wallet_directory.py) and is a normal bounded query instead."""
    rows = db.fetchall('SELECT wallet, username, best_pnl FROM wallet_directory')
    return [{'wallet': w, 'username': u, 'best_pnl': float(p) if p is not None else None} for w, u, p in rows]


def build_roster(all_users, size=ROSTER_SIZE):
    ranked = sorted(all_users, key=lambda u: -(u['best_pnl'] if u['best_pnl'] is not None else -1e18))[:size]
    return {u['wallet'].lower() for u in ranked}


def load_config(db):
    """app_settings table — written by the Settings page (direct Supabase
    write from the browser now, not through a local proxy), read here on a
    short timer. Any failure just falls back to the hardcoded defaults, so
    this is safe even if the row is missing or the UI has never been used."""
    defaults = {
        'roster_size': ROSTER_SIZE,
        'tiers': list(TIERS),
        'ticker_min_usd': TICKER_MIN_USD,
        'scalp_window_minutes': SCALP_WINDOW_SECONDS // 60,
        'tracked_wallets': set(),
    }
    try:
        row = db.fetchone(
            'SELECT roster_size, tiers, ticker_min_usd, scalp_window_minutes FROM app_settings WHERE id = 1'
        )
        if row:
            roster_size, tiers, ticker_min_usd, scalp_window_minutes = row
            defaults['roster_size'] = roster_size
            defaults['tiers'] = list(tiers)
            defaults['ticker_min_usd'] = ticker_min_usd
            defaults['scalp_window_minutes'] = scalp_window_minutes
    except Exception:
        pass
    try:
        # Manually-tracked wallets (added via the Lookup page) — expire after
        # 30 days of inactivity by just dropping out of this query, not by
        # deleting the row, so a wallet that trades again later resumes being
        # tracked automatically without needing to be re-added.
        rows = db.fetchall('''SELECT wallet FROM tracked_wallets
            WHERE COALESCE(last_active_at, added_at) > now() - interval '30 days' ''')
        defaults['tracked_wallets'] = {r[0].lower() for r in rows}
    except Exception:
        pass
    return defaults


def apply_config(cfg, roster_set, all_users):
    """Reassigning these module globals is enough — every read site
    (process_trade, record_exit, etc.) looks the name up fresh each call
    rather than holding a stale local copy, so this takes effect on the
    very next trade with no restart.
    roster_set is mutated in place (clear+update) rather than reassigned, since
    main() and every in-flight executor.submit closure already hold a reference
    to that exact set object. The clear+update pair runs under state_lock —
    process_trade's roster membership check takes the same lock, so a trade
    can never observe the roster mid-swap (momentarily empty between clear()
    and update() landing) and get silently dropped."""
    global TIERS, TICKER_MIN_USD, SCALP_WINDOW_SECONDS
    TIERS = sorted(float(t) if not float(t).is_integer() else int(t) for t in cfg['tiers'])
    TICKER_MIN_USD = cfg['ticker_min_usd']
    SCALP_WINDOW_SECONDS = cfg['scalp_window_minutes'] * 60
    new_roster = build_roster(all_users, cfg['roster_size']) | cfg.get('tracked_wallets', set())
    if new_roster != roster_set:
        with state_lock:
            roster_set.clear()
            roster_set.update(new_roster)


def build_wallet_names(all_users):
    """Free local lookup for display names — reuses the leaderboard scrape
    already on disk instead of hitting Polymarket's API again. Covers all
    286k scraped wallets, not just the 500-wallet roster, so ticker trades
    from non-roster wallets can still get a name when they happen to be
    someone who's ranked on any leaderboard before."""
    return {u['wallet'].lower(): u.get('username') for u in all_users if u.get('username')}


# ---------------- market/token universe ----------------

MARKET_FETCH_MAX_OFFSET = 2000  # verified live: offset paginates correctly through here (each
# page genuinely new markets), then 422s at offset=2100 ("offset too large") — a real, documented
# ceiling on this endpoint, not a number we're choosing to save time.

def fetch_active_tokens():
    """Returns (token_list, token_info) where token_info[token_id] =
    {conditionId, outcome, slug, title}.

    Uses /markets?offset=..., NOT /markets/keyset — moved to keyset previously
    to get past this endpoint's ~2,000-market ceiling, but verified live
    (2026-08-01) that /markets/keyset's cursor is currently broken: every
    page after the first returns the identical 100 markets regardless of
    sort order, so in practice it was only ever covering ~100 of the
    intended ~15,000 markets. /markets?offset=... still paginates correctly
    (spot-checked every page up to the wall — genuinely new markets each
    time) and reliably covers ~2,089 unique markets before the known 422 at
    offset~2100, which is what caps MARKET_FETCH_MAX_OFFSET. If Polymarket
    fixes the keyset cursor later, that's worth revisiting for the fuller
    ~20k+ coverage — for now this covers ~20x what keyset was actually
    delivering."""
    tokens, token_info = [], {}
    offset = 0
    while offset <= MARKET_FETCH_MAX_OFFSET:
        url = (f'https://gamma-api.polymarket.com/markets?limit=100&offset={offset}'
               '&active=true&closed=false&order=volume24hr&ascending=false')
        data = get_json(url)
        markets = data if isinstance(data, list) else (data.get('markets', []) if data else [])
        if not markets:
            if data is None:
                print(f'  (market fetch offset {offset} failed after retries, stopping there)')
            break
        for m in markets:
            ids = m.get('clobTokenIds')
            outcomes = m.get('outcomes')
            if isinstance(ids, str):
                ids = json.loads(ids)
            if isinstance(outcomes, str):
                outcomes = json.loads(outcomes)
            if not ids or not outcomes or len(ids) != len(outcomes):
                continue
            events = m.get('events')
            event_id = events[0].get('id') if events else None
            # Polymarket's public /event/{slug} page uses the parent event's
            # slug, not a market's own `slug` — for grouped/templated markets
            # (recurring date families) those differ and the market's own
            # slug 404s. Falls back to the market's own slug for the rare
            # case a market has no parent event.
            event_slug = events[0].get('slug') if events else None
            for tid, outcome in zip(ids, outcomes):
                tokens.append(tid)
                token_info[tid] = {
                    'conditionId': m.get('conditionId'), 'outcome': outcome,
                    'slug': m.get('slug'), 'title': m.get('question') or m.get('slug'),
                    'eventId': event_id, 'eventSlug': event_slug or m.get('slug'),
                }
        offset += 100
        if offset % 1000 == 0:
            print(f'  ...fetched offset {offset}, {len(tokens)} tokens so far')
    return tokens, token_info


WATCHED_MARKETS_DUMP_PATH = '/tmp/watched_markets.json'


def dump_watched_markets(token_info):
    """Diagnostic-only (2026-08-26) — writes the exact set of condition_ids
    this process is currently subscribed to, so an external check can
    compare against real Polymarket trade history without independently
    re-deriving the "top by volume" list itself, which turned out to shift
    meaningfully between successive calls and produced contradictory
    overlap results when compared that way."""
    try:
        condition_ids = sorted({info['conditionId'] for info in token_info.values() if info.get('conditionId')})
        with open(WATCHED_MARKETS_DUMP_PATH, 'w') as f:
            json.dump({'dumped_at': time.time(), 'condition_ids': condition_ids}, f)
    except Exception as e:
        print(f'  (dump_watched_markets failed, non-fatal: {e})')


# ---------------- raw-socket WebSocket client ----------------

def ws_connect():
    key = base64.b64encode(os.urandom(16)).decode()
    req = (f'GET {WS_PATH} HTTP/1.1\r\nHost: {WS_HOST}\r\nUpgrade: websocket\r\n'
           f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n')
    ctx = ssl.create_default_context()
    sock = socket.create_connection((WS_HOST, 443), timeout=15)
    ssock = ctx.wrap_socket(sock, server_hostname=WS_HOST)
    # Bound the handshake read explicitly, before the byte-at-a-time loop below —
    # previously this was only set after the loop, so a peer that accepted the
    # connection and TLS handshake but then stalled mid-response (no more data,
    # no close) left recv(1) blocking with no timeout at all. That's what caused
    # a real 6-hour production hang: the process stayed "active" per systemd but
    # never logged another line. The deadline check is defense-in-depth against
    # a slow trickle of single bytes that individually never time out.
    ssock.settimeout(15)
    ssock.send(req.encode())
    resp = b''
    deadline = time.time() + 15
    while b'\r\n\r\n' not in resp:
        if time.time() > deadline:
            raise ConnectionError('handshake response timed out')
        resp += ssock.recv(1)
    if b'101' not in resp.split(b'\r\n')[0]:
        raise ConnectionError(f'handshake failed: {resp[:200]}')
    ssock.settimeout(1.0)
    return ssock


def send_frame(ssock, payload: bytes, opcode=0x1):
    mask = os.urandom(4)
    masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
    length = len(payload)
    header = bytes([0x80 | opcode])
    if length < 126:
        header += bytes([0x80 | length])
    elif length < 65536:
        header += bytes([0x80 | 126]) + struct.pack('>H', length)
    else:
        header += bytes([0x80 | 127]) + struct.pack('>Q', length)
    ssock.send(header + mask + masked)


def recv_frames(ssock, buf):
    try:
        chunk = ssock.recv(65536)
        if chunk:
            buf.extend(chunk)
        elif chunk == b'':
            raise ConnectionError('socket closed by server')
    except socket.timeout:
        pass
    frames = []
    while len(buf) >= 2:
        b0, b1 = buf[0], buf[1]
        opcode = b0 & 0x0F
        length = b1 & 0x7F
        offset = 2
        if length == 126:
            if len(buf) < 4:
                break
            length = struct.unpack('>H', buf[2:4])[0]
            offset = 4
        elif length == 127:
            if len(buf) < 10:
                break
            length = struct.unpack('>Q', buf[2:10])[0]
            offset = 10
        if len(buf) < offset + length:
            break
        payload = bytes(buf[offset:offset + length])
        del buf[:offset + length]
        frames.append((opcode, payload))
    return frames


# ---------------- persistence ----------------

class Database:
    """Wraps a real connection pool (psycopg_pool.ConnectionPool), not a
    single shared connection. Schema lives in supabase/migrations/*.sql —
    this never creates or alters tables, it only connects and runs
    statements. Every write used to serialize through one connection
    guarded by one Python lock — confirmed live that this was the actual
    throughput ceiling under real trade volume (a fast, non-RPC write
    could stall for minutes behind an unrelated slow one, and no amount of
    ThreadPoolExecutor worker-count tuning fixed it, since more workers
    just meant more threads queued on the same lock). A real pool lets
    Postgres handle concurrent writes at the database level, the way it's
    designed to.

    fetchall()/fetchone()/execute() each check out a connection, run one
    statement, and return before the connection goes back to the pool —
    results are fully materialized inside that scope, never a live cursor
    handed back to the caller (a cursor from a connection that's already
    back in the pool, possibly claimed by another thread, would be a real
    bug under pooling even though it was safe under the old single-shared-
    connection model). run_transaction() checks out one connection for the
    whole callback, same as before, for statements that must commit
    together or not at all.

    Commit/rollback are explicit here rather than relying on
    pool.connection()'s own auto-commit-on-clean-exit behavior (confirmed
    via source that it does this, and also auto-replaces a broken
    connection on return) — belt and suspenders, matches this file's
    existing explicit style, and removes any doubt."""

    def __init__(self, database_url, pool_size=8):
        self.pool = ConnectionPool(
            database_url, min_size=pool_size, max_size=pool_size,
            kwargs={'autocommit': False}, open=False,
        )
        # open=False + explicit open(wait=True) — verified via source that
        # open=False alone leaves the pool unusable (raises PoolClosed)
        # until opened; wait=True blocks here until pool_size connections
        # are actually ready, matching the old code's eager psycopg.connect()
        # fail-fast-at-startup behavior instead of failing lazily on first use.
        self.pool.open(wait=True, timeout=30)

    def fetchall(self, sql, params=None):
        with self.pool.connection() as conn:
            cur = conn.execute(sql, params)
            rows = cur.fetchall()
            conn.commit()
            return rows

    def fetchone(self, sql, params=None):
        with self.pool.connection() as conn:
            cur = conn.execute(sql, params)
            row = cur.fetchone()
            conn.commit()
            return row

    def execute(self, sql, params=None):
        with self.pool.connection() as conn:
            conn.execute(sql, params)
            conn.commit()

    def executemany(self, sql, params_seq):
        with self.pool.connection() as conn:
            with conn.cursor() as cur:
                cur.executemany(sql, params_seq)
            conn.commit()

    def run_transaction(self, fn):
        """Runs fn(conn) — fn issues one or more related statements
        directly against the connection (free to read intermediate
        results, e.g. a RETURNING clause, to build later statements) and
        everything commits together at the end, or none of it does. Used
        for logically-related writes (e.g. a contribution's wallet row +
        its paired opportunity_stats delta) that must never partially
        apply if an error interrupts the sequence midway."""
        with self.pool.connection() as conn:
            try:
                result = fn(conn)
            except Exception:
                conn.rollback()
                raise
            conn.commit()
            return result


def record_tier_crossed(db, condition_id, outcome, token_info, cumulative_usd, tier, wallet_count, price, trade_ts):
    slug = title = event_slug = None
    category = 'other'
    meta = token_info.get((condition_id, outcome))
    if meta:
        slug, title = meta.get('slug'), meta.get('title')
        event_slug = meta.get('eventSlug')
        category = fetch_event_category(meta.get('eventId'))

    def txn(conn):
        # Serializes tier-crossing writes for this exact market (rare — at
        # most 6 per market, ever) so the is_current MAX(tier) subquery below
        # always sees a consistent picture, even though worker threads now
        # run against a pooled connection instead of one shared connection.
        conn.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))',
                      (f'{condition_id}|{outcome}',))
        conn.execute('''INSERT INTO opportunities
            (condition_id, outcome, slug, event_slug, title, cumulative_usd, tier, wallet_count, first_seen, last_updated, latest_price, category)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (condition_id, outcome, tier) DO NOTHING''',
            (condition_id, outcome, slug, event_slug, title, cumulative_usd, tier, wallet_count, trade_ts, trade_ts, price, category))
        conn.execute('''UPDATE opportunities SET cumulative_usd=%s, wallet_count=%s, last_updated=%s, latest_price=%s, category=%s
            WHERE condition_id=%s AND outcome=%s AND tier=%s''',
            (cumulative_usd, wallet_count, trade_ts, price, category, condition_id, outcome, tier))
        # is_current replaces the view's old MAX(tier) GROUP BY — flip it here
        # instead of recomputing it on every read, via an actual MAX(tier)
        # subquery rather than "tier = this call's tier" (different trades
        # for the same market can commit out of tier order across worker
        # threads — confirmed live via a dev dry-run). Self-correcting
        # regardless of commit order, protected by the advisory lock above.
        conn.execute('''UPDATE opportunities SET is_current = (tier = (
                SELECT MAX(tier) FROM opportunities WHERE condition_id=%s AND outcome=%s
            )) WHERE condition_id=%s AND outcome=%s''',
                   (condition_id, outcome, condition_id, outcome))

    db.run_transaction(txn)
    mark_opportunity_dirty(condition_id, outcome)


def record_contribution(db, condition_id, outcome, wallet, wallet_name, usd, price, trade_ts):
    # trade_ts (the real on-chain trade time) is what "ts" means to anyone
    # reading it later — used for FIFO exit ordering and displayed as "Xm
    # ago". updated_at stays processing time deliberately: if it ever
    # visibly lags trade_ts, that gap IS the backlog signal.
    processed_at = datetime.now(timezone.utc)
    shares = usd / price

    # opportunity_stats/opportunity_contributors: the incrementally-
    # maintained aggregates opportunities_live will read from once cut over,
    # instead of a GROUP BY over all of opportunity_wallets on every query.
    # wallet_count only needs "have I already counted this wallet" (rows are
    # never deleted, so it's monotonic) — the INSERT ... ON CONFLICT DO
    # NOTHING RETURNING tells us that in one statement, no separate
    # existence check needed. All three statements run as one transaction —
    # a connection hiccup partway through must never leave the wallet row
    # persisted with its paired stats delta lost.
    def txn(conn):
        conn.execute('''INSERT INTO opportunity_wallets (condition_id, outcome, wallet, wallet_name, usd, price, ts)
            VALUES (%s,%s,%s,%s,%s,%s,%s)''', (condition_id, outcome, wallet, wallet_name, usd, price, trade_ts))
        cur = conn.execute('''INSERT INTO opportunity_contributors (condition_id, outcome, wallet)
            VALUES (%s,%s,%s) ON CONFLICT DO NOTHING RETURNING 1''', (condition_id, outcome, wallet))
        is_new_wallet = 1 if cur.fetchone() is not None else 0
        conn.execute('''INSERT INTO opportunity_stats
                (condition_id, outcome, entries, wallet_count, cumulative_usd, open_shares_sum, open_invested_usd, updated_at)
            VALUES (%s,%s,1,%s,%s,%s,%s,%s)
            ON CONFLICT (condition_id, outcome) DO UPDATE SET
                entries = opportunity_stats.entries + 1,
                wallet_count = opportunity_stats.wallet_count + %s,
                cumulative_usd = opportunity_stats.cumulative_usd + %s,
                open_shares_sum = opportunity_stats.open_shares_sum + %s,
                open_invested_usd = opportunity_stats.open_invested_usd + %s,
                updated_at = %s''',
            (condition_id, outcome, is_new_wallet, usd, shares, usd, processed_at,
             is_new_wallet, usd, shares, usd, processed_at))

    db.run_transaction(txn)


def touch_tracked_wallet(db, wallet):
    """No-op for wallets that are only in the top-N-by-pnl roster (not in
    tracked_wallets at all) — the UPDATE just affects zero rows for those.
    For a manually-tracked wallet, this is what keeps it from expiring out
    of load_config()'s 30-day-inactivity filter."""
    db.execute('UPDATE tracked_wallets SET last_active_at = %s WHERE wallet = %s',
                (datetime.now(timezone.utc), wallet))


def record_exit(db, condition_id, outcome, wallet, price, usd, trade_ts):
    """Closes the oldest still-open contribution row for this wallet+market
    (FIFO — this is a best-effort signal classifier, not real accounting) and
    classifies the round trip as a scalp (held < SCALP_WINDOW_SECONDS) or a
    genuine exit. Returns (hold_seconds, is_scalp) or None if this wallet has
    no tracked open entry here (e.g. they sold a position opened before this
    process started watching, or before it started tracking sells at all)."""
    # hold_seconds/exit_ts use trade_ts (the real SELL time) — using
    # processing time here would inflate hold_seconds by however long the
    # trade sat queued, which could misclassify a genuine scalp as a
    # longer hold. updated_at stays processing time (see record_contribution).
    processed_at = datetime.now(timezone.utc)

    def txn(conn):
        # FOR UPDATE SKIP LOCKED: under a pooled connection, two concurrent
        # SELLs for the same wallet+market could otherwise both SELECT the
        # same oldest-open row before either commits, double-closing one
        # position and double-decrementing opportunity_stats. SKIP LOCKED
        # makes a second concurrent SELL skip the row already claimed by an
        # in-flight transaction and fall through to the next genuinely-open
        # one — correct FIFO behavior under real concurrency.
        row = conn.execute('''SELECT id, ts, usd, price FROM opportunity_wallets
            WHERE condition_id=%s AND outcome=%s AND wallet=%s AND exit_ts IS NULL
            ORDER BY ts ASC LIMIT 1 FOR UPDATE SKIP LOCKED''', (condition_id, outcome, wallet)).fetchone()
        if not row:
            return None
        row_id, buy_ts, entry_usd, entry_price = row
        hold_seconds = trade_ts.timestamp() - buy_ts.timestamp()
        is_scalp = hold_seconds <= SCALP_WINDOW_SECONDS
        conn.execute('''UPDATE opportunity_wallets SET exit_ts=%s, exit_price=%s, exit_usd=%s, hold_seconds=%s, is_scalp=%s
            WHERE id=%s''', (trade_ts, price, usd, hold_seconds, is_scalp, row_id))
        # Realized profit uses the ORIGINAL entry's implied shares valued at
        # exit price, not the actual exit_usd — matches the formula the view
        # (and the backfill) already use: (entry_usd/entry_price)*exit_price
        # - entry_usd, not anything derived from the sell trade's own $ size.
        shares = float(entry_usd) / float(entry_price)
        realized_delta = shares * price - float(entry_usd)
        conn.execute('''UPDATE opportunity_stats SET
                exited = exited + 1,
                scalped = scalped + %s,
                realized_profit = realized_profit + %s,
                open_shares_sum = open_shares_sum - %s,
                open_invested_usd = open_invested_usd - %s,
                updated_at = %s
            WHERE condition_id=%s AND outcome=%s''',
            (1 if is_scalp else 0, realized_delta, shares, entry_usd, processed_at, condition_id, outcome))
        return hold_seconds, is_scalp

    return db.run_transaction(txn)


def check_market_closed(slug):
    """A market that resolves settles every open position automatically on-chain —
    no SELL trade ever happens, so record_exit() can never catch it. Without this
    check, a resolved market's positions show as 'still holding' forever. Returns
    {outcome: won_bool} if the market has closed, else None (still open)."""
    if not slug:
        return None
    try:
        req = urllib.request.Request(f'https://gamma-api.polymarket.com/markets?slug={slug}&closed=true', headers=UA)
        with urllib.request.urlopen(req, timeout=8) as r:
            rows = json.load(r)
        if not rows:
            return None  # not closed yet
        m = rows[0]
        outcomes = m.get('outcomes')
        prices = m.get('outcomePrices')
        if isinstance(outcomes, str):
            outcomes = json.loads(outcomes)
        if isinstance(prices, str):
            prices = json.loads(prices)
        if not outcomes or not prices or len(outcomes) != len(prices):
            return {}  # closed but resolution data not parseable — still mark closed, just no win/loss
        return {o: float(p) >= 0.5 for o, p in zip(outcomes, prices)}
    except Exception:
        return None  # transient failure — try again on the next sweep, don't guess


def fetch_usdc_balance(wallet, retries=2, retry_delay=1.0):
    """USDC.e balanceOf(wallet) via a plain eth_call — a read call, not a
    transaction, so no gas/signing involved. Same RPC_PROVIDERS
    fallback/retry pattern as resolve_tx_sender, just a different method."""
    padded = wallet[2:].lower().rjust(64, '0')
    body = json.dumps({
        'jsonrpc': '2.0', 'id': 1, 'method': 'eth_call',
        'params': [{'to': USDC_CONTRACT, 'data': BALANCE_OF_SELECTOR + padded}, 'latest'],
    }).encode()
    for attempt in range(retries):
        for rpc in RPC_PROVIDERS:
            try:
                req = urllib.request.Request(rpc, data=body, headers={'Content-Type': 'application/json', **UA})
                with urllib.request.urlopen(req, timeout=8) as r:
                    res = json.load(r)
                result = res.get('result')
                if result and result != '0x':
                    return int(result, 16) / 1e6  # USDC.e has 6 decimals
            except Exception as e:
                if os.environ.get('LSS_DEBUG'):
                    print(f'  [debug] {rpc} attempt {attempt}: EXCEPTION {type(e).__name__}: {e}')
                continue
        if attempt < retries - 1:
            time.sleep(retry_delay)
    return None


def refresh_wallet_balances(db, wallets):
    """Runs periodically (BALANCE_REFRESH_SECONDS, see main()) — refreshes
    USDC.e balances for the current roster + tracked wallets, the data the
    win-rate/bet-ratio filters on Live Ticker and Vetted Picks need. Fans
    out across a local thread pool (a few hundred wallets sequentially over
    RPC would take minutes; this is a cheap read call, safe to parallelize)."""
    wallets = list(wallets)
    if not wallets:
        return
    results = {}
    with ThreadPoolExecutor(max_workers=16) as pool:
        futures = {pool.submit(fetch_usdc_balance, w): w for w in wallets}
        for fut, wallet in futures.items():
            try:
                bal = fut.result()
            except Exception:
                bal = None
            if bal is not None:
                results[wallet] = bal
    if not results:
        return
    now = datetime.now(timezone.utc)
    for wallet, bal in results.items():
        db.execute('''INSERT INTO wallet_balances (wallet, usdc_balance, updated_at)
            VALUES (%s,%s,%s)
            ON CONFLICT (wallet) DO UPDATE SET usdc_balance=EXCLUDED.usdc_balance, updated_at=EXCLUDED.updated_at''',
            (wallet, bal, now))
    print(f'  [balances] refreshed {len(results)}/{len(wallets)} wallet balances')


# The publishable/anon key — same one already shipped to every browser in
# the frontend bundle (src/lib/domains.ts's VITE_PROD_SUPABASE_ANON_KEY),
# not a secret. Hardcoded rather than read from the environment since the
# VM's .env only carries DATABASE_URL — this ping doesn't warrant adding a
# second, never-otherwise-needed var there just to duplicate a public value.
PROD_SUPABASE_URL = 'https://vohtqodprqpobvvcdypy.supabase.co'
PROD_SUPABASE_ANON_KEY = 'sb_publishable_40wj27zEnBRLxHnEZbn9Eg_QSzDTwsH'


def ping_wallet_search():
    """Runs periodically (WARM_SEARCH_SECONDS, see main()) — the /search
    page's wallet-search Edge Function only gets invoked by actual visitor
    traffic, sporadic enough that it regularly goes cold between requests.
    A cold isolate added 4-5s on top of the ~1s the function's own logic
    actually takes, measured directly against prod. A cheap OPTIONS ping
    (handled before any real work in wallet-search/index.ts) exercises the
    same isolate-spin-up path without doing a real Polymarket/DB lookup, so
    real visitor requests land on an already-warm isolate instead."""
    try:
        req = urllib.request.Request(
            f'{PROD_SUPABASE_URL}/functions/v1/wallet-search', method='OPTIONS',
            headers={'apikey': PROD_SUPABASE_ANON_KEY, **UA},
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass


def refresh_opportunity_aggregates(db):
    """Runs periodically (AGGREGATE_REFRESH_SECONDS, see main()) — recomputes
    the two per-(condition_id, outcome) aggregates opportunities_live joins
    against (best_win_rate, best_bet_ratio). These used to be computed
    inline in that view via CTEs re-aggregated on every single API request;
    under real traffic a cold connection could spike past PostgREST's 8s
    statement_timeout (57014 -> 500 to the frontend). Precomputing here and
    letting the view do a plain indexed join instead keeps every request
    fast regardless of connection/cache state — see
    supabase/migrations/20260817010000_precompute_opportunity_aggregates.sql
    for the full story and the query this mirrors."""
    now = datetime.now(timezone.utc)
    db.execute('''
        INSERT INTO opportunity_best_win_rate (condition_id, outcome, best_win_rate, updated_at)
        SELECT oc.condition_id, oc.outcome,
          MAX(CASE WHEN (ls.won + ls.lost) > 0 THEN ls.won::numeric / (ls.won + ls.lost)::numeric ELSE NULL END),
          %s
        FROM opportunity_contributors oc
        LEFT JOIN leaderboard ls ON ls.wallet = oc.wallet
        GROUP BY oc.condition_id, oc.outcome
        ON CONFLICT (condition_id, outcome) DO UPDATE SET
          best_win_rate = EXCLUDED.best_win_rate, updated_at = EXCLUDED.updated_at
    ''', (now,))
    db.execute('''
        INSERT INTO opportunity_best_bet_ratio (condition_id, outcome, best_bet_ratio, updated_at)
        SELECT ow.condition_id, ow.outcome, MAX(ow.usd / wb.usdc_balance), %s
        FROM opportunity_wallets ow
        JOIN wallet_balances wb ON wb.wallet = ow.wallet AND wb.usdc_balance >= 1
        GROUP BY ow.condition_id, ow.outcome
        ON CONFLICT (condition_id, outcome) DO UPDATE SET
          best_bet_ratio = EXCLUDED.best_bet_ratio, updated_at = EXCLUDED.updated_at
    ''', (now,))
    print('  [aggregates] refreshed best_win_rate / best_bet_ratio')


def refresh_leaderboard(db):
    """Runs periodically (LEADERBOARD_REFRESH_SECONDS, see main()) —
    recomputes leaderboard_cache, the table the `leaderboard` view now just
    passes through. This used to be a live SUM/COUNT GROUP BY over the full
    opportunity_wallets table (650k+ rows and growing) computed on every
    single read of it, including the Leaderboard page itself and every join
    against it elsewhere (opportunities_live, wallet_balances). Precomputing
    here turns every one of those reads into a plain indexed lookup — see
    supabase/migrations/20260830000000_precompute_leaderboard.sql for the
    full story and the query this mirrors."""
    now = datetime.now(timezone.utc)
    db.execute('''
        INSERT INTO leaderboard_cache (wallet, wallet_name, n, won, lost, deployed, won_usd, net_profit, updated_at)
        SELECT wallet, MAX(wallet_name),
          COUNT(*),
          SUM(CASE WHEN resolved_win = true THEN 1 ELSE 0 END),
          SUM(CASE WHEN resolved_win = false THEN 1 ELSE 0 END),
          SUM(usd),
          SUM(CASE WHEN resolved_win = true THEN usd ELSE 0 END),
          SUM(CASE WHEN resolved_win = true THEN (usd / price) - usd ELSE -usd END),
          %s
        FROM opportunity_wallets
        WHERE market_closed = true AND wallet IS NOT NULL
        GROUP BY wallet
        ON CONFLICT (wallet) DO UPDATE SET
          wallet_name = EXCLUDED.wallet_name, n = EXCLUDED.n, won = EXCLUDED.won, lost = EXCLUDED.lost,
          deployed = EXCLUDED.deployed, won_usd = EXCLUDED.won_usd, net_profit = EXCLUDED.net_profit,
          updated_at = EXCLUDED.updated_at
    ''', (now,))
    print('  [aggregates] refreshed leaderboard_cache')


def refresh_wallet_category_breakdown(db):
    """Runs periodically (WALLET_CATEGORY_REFRESH_SECONDS, see main()) —
    recomputes wallet_category_breakdown_cache, the table the
    `wallet_category_breakdown` view now just passes through. This used to
    be a live GROUP BY joining opportunity_wallets against a re-aggregated
    "one category per market" subquery over the *entire* opportunities
    table, recomputed from scratch on every single call regardless of which
    wallet was asked about — see
    supabase/migrations/20260830010000_precompute_wallet_category_breakdown_and_index.sql
    for the full story and the query this mirrors."""
    now = datetime.now(timezone.utc)
    db.execute('''
        INSERT INTO wallet_category_breakdown_cache (wallet, category, n, won, lost, profit, updated_at)
        SELECT ow.wallet, COALESCE(o.category, 'other'),
          COUNT(*),
          SUM(CASE WHEN ow.resolved_win = true THEN 1 ELSE 0 END),
          SUM(CASE WHEN ow.resolved_win = false THEN 1 ELSE 0 END),
          SUM(CASE WHEN ow.resolved_win = true THEN (ow.usd / ow.price) - ow.usd ELSE -ow.usd END),
          %s
        FROM opportunity_wallets ow
        JOIN (SELECT condition_id, outcome, MAX(category) AS category FROM opportunities GROUP BY condition_id, outcome) o
          ON o.condition_id = ow.condition_id AND o.outcome = ow.outcome
        WHERE ow.market_closed = true
        GROUP BY ow.wallet, COALESCE(o.category, 'other')
        ON CONFLICT (wallet, category) DO UPDATE SET
          n = EXCLUDED.n, won = EXCLUDED.won, lost = EXCLUDED.lost, profit = EXCLUDED.profit,
          updated_at = EXCLUDED.updated_at
    ''', (now,))
    print('  [aggregates] refreshed wallet_category_breakdown_cache')


def sweep_resolved_positions(db):
    """Runs periodically (not per-trade — this is a network call per distinct open
    market, too slow to do inline). Finds every market with still-open positions,
    checks whether it has resolved, and closes out all its open rows at once."""
    rows = db.fetchall('''SELECT DISTINCT ow.condition_id, ow.outcome, o.slug
        FROM opportunity_wallets ow
        JOIN opportunities o ON o.condition_id = ow.condition_id AND o.outcome = ow.outcome
        WHERE ow.exit_ts IS NULL AND (ow.market_closed IS NULL OR ow.market_closed = false)''')

    distinct_slugs = list({slug for _, _, slug in rows})
    # One HTTP call per distinct slug — confirmed live this backlog can be
    # 300 distinct slugs at once, and doing these sequentially (as this
    # function used to) could take minutes for a single pass, leaving
    # already-resolved markets showing stale data the whole time. These are
    # independent, I/O-bound calls, so they parallelize cleanly.
    slug_results = {}
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {pool.submit(check_market_closed, slug): slug for slug in distinct_slugs}
        for fut in futures:
            slug_results[futures[fut]] = fut.result()

    closed_count = 0
    for condition_id, outcome, slug in rows:
        result = slug_results.get(slug)
        if result is None:
            continue  # still open
        won = result.get(outcome)
        now = datetime.now(timezone.utc)

        # Consecutive sweep calls can overlap if one is still waiting on
        # slow/flaky gamma-api responses when the next 5-minute tick fires —
        # confirmed live via a dev dry-run. Both would see this pair as a
        # candidate before either closes it. The market_closed guard below
        # (matching the SELECT above) makes a second/racing attempt a true
        # no-op (rowcount=0) instead of re-matching the same already-closed
        # rows and double-counting closed/won/lost.
        def txn(conn, condition_id=condition_id, outcome=outcome, won=won, now=now):
            cur = conn.execute('''UPDATE opportunity_wallets SET market_closed=true, resolved_win=%s, resolved_ts=%s
                WHERE condition_id=%s AND outcome=%s AND exit_ts IS NULL
                    AND (market_closed IS NULL OR market_closed = false)''',
                (won, now, condition_id, outcome))
            n = cur.rowcount
            if n == 0:
                return 0
            # Mark-to-market (both the trade-tick and price_change paths) only
            # ever runs while a market is still actively trading — once it
            # resolves, no more WS events for it arrive, so latest_price was
            # freezing at whatever it happened to be right before resolution
            # instead of snapping to the real final price. Confirmed live: a
            # market that resolved Under=$0 was still showing 16c on the
            # Signals page because nothing ever wrote the resolved price.
            if won is not None:
                conn.execute('UPDATE opportunities SET latest_price=%s WHERE condition_id=%s AND outcome=%s',
                           (1.0 if won else 0.0, condition_id, outcome))
            # record_exit's WHERE exit_ts IS NULL and this sweep's identical
            # filter are mutually exclusive by construction, so the market's
            # entire currently-open set is exactly what's being closed in
            # this batch — the current open_shares_sum/open_invested_usd
            # values themselves ARE the batch aggregate, no extra query
            # needed beyond fetching them once to compute the delta.
            stat_row = conn.execute('''SELECT open_shares_sum, open_invested_usd FROM opportunity_stats
                WHERE condition_id=%s AND outcome=%s''', (condition_id, outcome)).fetchone()
            open_shares, open_invested = stat_row if stat_row else (0, 0)
            if won is True:
                realized_delta = float(open_shares) - float(open_invested)
                won_inc, lost_inc = n, 0
            elif won is False:
                realized_delta = -float(open_invested)
                won_inc, lost_inc = 0, n
            else:
                # Ambiguous resolution (gamma-api couldn't determine a
                # winner) — a wash, not a loss, consistent with won/lost
                # already counting it as neither.
                realized_delta = 0.0
                won_inc, lost_inc = 0, 0
            conn.execute('''INSERT INTO opportunity_stats
                    (condition_id, outcome, closed, won, lost, realized_profit, open_shares_sum, open_invested_usd, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,0,0,%s)
                ON CONFLICT (condition_id, outcome) DO UPDATE SET
                    closed = opportunity_stats.closed + %s,
                    won = opportunity_stats.won + %s,
                    lost = opportunity_stats.lost + %s,
                    realized_profit = opportunity_stats.realized_profit + %s,
                    open_shares_sum = 0, open_invested_usd = 0, updated_at = %s''',
                (condition_id, outcome, n, won_inc, lost_inc, realized_delta, now,
                 n, won_inc, lost_inc, realized_delta, now))
            return n

        n = db.run_transaction(txn)
        if n and won is not None:
            with state_lock:
                resolved_markets.add((condition_id, outcome))
            mark_opportunity_dirty(condition_id, outcome)  # only this txn's opportunities.latest_price write is relevant here
        if n:
            closed_count += 1
    if closed_count:
        print(f'  [resolved] {closed_count} market/outcome pairs closed out (positions settled by resolution, not a sale)')


def parse_trade_ts(item):
    """Every last_trade_price WS event carries its own timestamp (ms since
    epoch) — confirmed live via a raw message dump. Using it instead of
    datetime.now() means a trade that sat queued behind an RPC-bound
    backlog is stored with the time it actually happened, not the time we
    got around to processing it. A market that traded at 58c 40 minutes
    ago and has since moved to 91c should show "40m ago", not "just now" —
    confirmed live: exactly this made a real, moved-on price look current.
    Falls back to processing time if the field is ever missing/malformed."""
    raw = item.get('timestamp')
    try:
        return datetime.fromtimestamp(int(raw) / 1000, tz=timezone.utc)
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)


def record_ticker_trade(db, info, usd, price, side, tx_hash, trade_ts):
    """Inserted immediately on a big-enough trade, BEFORE on-chain wallet
    resolution — this is what makes the ticker sub-second instead of waiting
    on an RPC round trip like the roster-matched signals do."""
    # No RETURNING/return value here — update_ticker_wallet matches by
    # tx_hash, not a ticker_id threaded back through the caller.
    db.execute('''INSERT INTO ticker
        (condition_id, outcome, slug, title, usd, price, side, tx_hash, wallet, roster_tagged, ts, epoch)
        VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NULL,false,%s,%s)''',
        (info['conditionId'], info['outcome'], info['slug'], info['title'],
         usd, price, side, tx_hash, trade_ts, trade_ts.timestamp()))


def update_ticker_wallet(db, tx_hash, wallet, wallet_name, roster_tagged, category):
    # Matched by tx_hash (+ still-unresolved guard) rather than the
    # ticker_id record_ticker_trade returns — simpler than threading that
    # id all the way through process_trade, and just as correct since a
    # tx_hash only ever gets one ticker row.
    db.execute('''UPDATE ticker SET wallet=%s, wallet_name=%s, roster_tagged=%s, category=%s
        WHERE tx_hash=%s AND wallet IS NULL''',
                (wallet, wallet_name, bool(roster_tagged), category, tx_hash))


def prune_ticker(db):
    cutoff = time.time() - TICKER_RETENTION_SECONDS
    db.execute('DELETE FROM ticker WHERE epoch < %s', (cutoff,))


# ---------------- signal processing ----------------

last_mtm_update = {}  # (conditionId, outcome) -> unix time of last mark-to-market write
MTM_THROTTLE_SECONDS = 15  # price_change fires far more often than trades — measured live:
# 490 price_change events vs 0 last_trade_price events in 20s for one token during an active
# game. The original ask was "stale for minutes/forever", not sub-second freshness — 15s
# is still a massive improvement while keeping write/executor volume sane across the full
# tracked set (after rehydrating tiers_hit at startup, that's every already-tracked market,
# not just ones with fresh activity since the last restart — a much bigger multiplier than
# when this was first tuned against a single token).


def filter_price_changes(keyed_token_info, item):
    """Cheap, synchronous, no I/O — runs inline in the main WS-receiving loop
    rather than going through the executor, because after rehydrating
    tiers_hit at startup (see main()) this runs against every tracked market
    at once, not just ones with fresh activity since the last restart. With
    ~1400 tracked markets live, submitting every single price_change event to
    the executor before even checking the throttle was flooding it — moved
    the filtering here so only events that actually pass the throttle (and
    so need a real DB write) ever reach the thread pool. Returns a list of
    (condition_id, outcome, mid_price) tuples ready to write."""
    now = time.time()
    updates = []
    for change in item.get('price_changes', []):
        tid = change.get('asset_id')
        info = keyed_token_info.get(tid)
        if not info:
            continue
        key = (info['conditionId'], info['outcome'])
        if key not in tiers_hit or key in resolved_markets:
            continue
        try:
            best_bid = float(change['best_bid'])
            best_ask = float(change['best_ask'])
        except (KeyError, TypeError, ValueError):
            continue
        if best_bid <= 0 or best_ask <= 0:
            continue
        if now - last_mtm_update.get(key, 0) < MTM_THROTTLE_SECONDS:
            continue
        last_mtm_update[key] = now
        updates.append((key[0], key[1], (best_bid + best_ask) / 2))
    return updates


def write_price_updates(db, updates):
    """The only part of price-change handling that touches the DB —
    submitted to the executor so a slow write never stalls the
    WS-receiving loop."""
    for condition_id, outcome, mid in updates:
        db.execute('UPDATE opportunities SET latest_price=%s WHERE condition_id=%s AND outcome=%s',
                   (mid, condition_id, outcome))
        mark_opportunity_dirty(condition_id, outcome)


# ---------------- realtime broadcast (opportunities only) ----------------
# opportunities' mark-to-market price ticks land continuously across ~1,400
# tracked markets — postgres_changes fires one message per row write with no
# way to batch, so that volume alone was blowing through the Realtime quota
# (worse, tripled by 3 separate frontend subscriptions before the shared-
# channel fix). Every write path touching `opportunities` stages a key here
# instead, and one background flush turns however many piled up into a
# batched broadcast — see main()'s BROADCAST_INTERVAL_SECONDS check.
#
# ticker was originally swept into this same batched design too, but its
# volume (~1 trade/sec, one subscriber, already merged in place rather than
# refetched) was never actually a quota problem — batching it just added a
# ~5s delay to what used to be an instant feed for no real benefit, so it's
# back on a plain postgres_changes subscription (see SignalsDemo.tsx).
MAX_BROADCAST_BATCH_ROWS = 200  # caps flush_dirty_broadcast's payload size — a flush
# after a large burst (e.g. catching up post-reconnect) used to try to bundle every
# dirty key into one message; Realtime's broadcast REST endpoint rejects oversized
# payloads with a 422, which then just silently dropped that flush's updates
# entirely. Capping means a big burst spreads over a few extra 5s cycles instead
# of failing outright — leftover keys stay dirty and get picked up next flush.

_dirty_lock = threading.Lock()
_dirty_opportunities = set()  # {(condition_id, outcome)} touched since the last flush


def mark_opportunity_dirty(condition_id, outcome):
    with _dirty_lock:
        _dirty_opportunities.add((condition_id, outcome))
    with state_lock:
        stats['old_message_estimate'] += 3  # HomePage + Terminal + SignalsDemo each had their own postgres_changes subscription


def broadcast_send(topic, event, payload):
    """POSTs one Realtime broadcast message via Supabase's REST broadcast
    endpoint — avoids holding open a websocket from this synchronous
    script just to publish. VITE_SUPABASE_URL/ANON_KEY (loaded by
    load_env()) already resolve to whichever project DATABASE_URL points
    at, same as the frontend's own env pair."""
    url = os.environ['VITE_SUPABASE_URL'].rstrip('/') + '/realtime/v1/api/broadcast'
    key = os.environ['VITE_SUPABASE_ANON_KEY']
    body = json.dumps({'messages': [{'topic': topic, 'event': event, 'payload': payload, 'private': False}]},
                       default=str).encode()
    req = urllib.request.Request(url, data=body, method='POST', headers={
        'Content-Type': 'application/json', 'apikey': key, 'Authorization': f'Bearer {key}',
    })
    try:
        urllib.request.urlopen(req, timeout=10).read()
        with state_lock:
            stats['broadcast_sends'] += 1
    except urllib.error.URLError as e:
        print(f'  [broadcast] failed to send {topic}/{event}: {e}')


def flush_dirty_broadcast(db):
    """Runs every BROADCAST_INTERVAL_SECONDS from the main loop (see
    main()) — bundles whatever opportunities rows changed since the last
    flush into at most one size-capped broadcast message, instead of each
    individual write triggering its own delivery."""
    with _dirty_lock:
        opp_keys = list(_dirty_opportunities)[:MAX_BROADCAST_BATCH_ROWS]
        for k in opp_keys:
            _dirty_opportunities.discard(k)

    if opp_keys:
        placeholders = ','.join(['(%s,%s)'] * len(opp_keys))
        params = [v for pair in opp_keys for v in pair]
        with db.pool.connection() as conn:
            with conn.cursor(row_factory=dict_row) as cur:
                cur.execute(f'SELECT * FROM opportunities_live WHERE (condition_id, outcome) IN ({placeholders})', params)
                rows = cur.fetchall()
            conn.commit()
        broadcast_send('opportunities-batch', 'update', {'rows': rows})


def process_trade(db, keyed_token_info, tid, price, size, side, tx_hash, wallet, roster, wallet_names, trade_ts, record_ticker=True):
    """Single combined path — a same-day attempt to split this into a fast
    (ticker/mark-to-market) and slow (RPC-bound wallet resolution) pool on
    two separate executors made things measurably worse, not better, and
    was reverted. Root cause, confirmed live: every DB write in this file,
    on either pool, still serialized through one shared psycopg connection
    guarded by one Python lock — concentrating the very high aggregate
    volume of write_price_updates onto its own small pool created worse
    lock contention than spreading it across the original 16-worker pool.
    trades_seen (the fast path's own counter) stayed flat while
    roster_matches (the slow path) kept climbing normally, proving the
    fast pool was lock-starved, not understaffed. The actual fix (this
    file's Database class) is a real connection pool, so concurrent DB
    writes execute concurrently at the Postgres level instead of being
    serialized through Python — the module-level `state_lock` below now
    only protects in-memory state, never a DB call.

    `wallet` is now passed in directly (2026-08-26 — see onchain_fills /
    poll_onchain_fills) rather than resolved here via resolve_trade_wallet.
    A single on-chain OrderFilled log settles a swap between exactly two
    parties, and the raw log alone tells us BOTH of their actions
    unambiguously — whoever received tokenId just bought it, whoever gave
    it up just sold it — so poll_onchain_fills calls this twice per fill,
    once per party, each with that party's own correct wallet+side. No
    trade-history lookup needed to tell buy from sell; it's just which end
    of the same swap this wallet was on.

    `record_ticker` gates the ticker/mark-to-market writes so they only
    happen on ONE of the two per-fill calls, not both — confirmed live
    (2026-08-26) that letting both calls write ticker broke
    update_ticker_wallet's own documented assumption ("a tx_hash only ever
    gets one ticker row"): with two rows sharing one tx_hash, whichever
    call's `WHERE tx_hash=... AND wallet IS NULL` ran first matched BOTH
    rows, silently overwriting the other party's row with its own wallet —
    every ticker entry for a fill showed the same trader on both the BUY
    and SELL line. Roster-matching (is this wallet one we track, did they
    enter or exit) still runs independently for both parties either way —
    only the ticker feed itself is per-fill, not per-party."""
    if side not in ('BUY', 'SELL') or not tx_hash:
        return
    info = keyed_token_info.get(tid)
    if not info:
        return
    with state_lock:
        stats['trades_seen'] += 1

    usd = (float(price) if price else 0) * (float(size) if size else 0)

    # Ticker: fires on size alone, immediately, before any RPC wait — this is
    # what makes it sub-second instead of gated on wallet resolution.
    if record_ticker and usd >= TICKER_MIN_USD:
        record_ticker_trade(db, info, usd, float(price) if price else 0, side, tx_hash, trade_ts)
        with state_lock:
            stats['ticker_trades'] += 1

    # Mark-to-market: keep latest_price tracking the real market, not just
    # the price at the last top-trader tier crossing. Previously latest_price
    # only got written inside record_tier_crossed, so a market's displayed
    # price/unrealized-profit went stale the moment top traders stopped
    # entering — even while the real price kept moving (e.g. a live sports
    # game swinging to 99% on ordinary market activity). Every trade tick on
    # a market we already track is a free, sub-second price update — no
    # extra network call, since we already receive it over the WS.
    key_probe = (info['conditionId'], info['outcome'])
    if record_ticker and price and float(price) > 0 and key_probe in tiers_hit and key_probe not in resolved_markets:
        last_mtm_update[key_probe] = time.time()  # a real fill is always fresher than a throttled quote update
        db.execute('UPDATE opportunities SET latest_price=%s WHERE condition_id=%s AND outcome=%s',
                   (float(price), key_probe[0], key_probe[1]))

    if usd <= 0:
        return

    wallet_name = wallet_names.get(wallet) if wallet else None
    if wallet and not wallet_name:
        if wallet in live_profile_cache:
            wallet_name = live_profile_cache[wallet]
            with state_lock:
                stats['profile_fetch_cache_hits'] += 1
        else:
            _t0 = time.time()
            wallet_name = fetch_live_profile_name(wallet)  # not in our local 261k dataset — try live, covers anyone with a profile
            live_profile_cache[wallet] = wallet_name
            with state_lock:
                stats['profile_fetch_count'] += 1
                stats['profile_fetch_ms'] += (time.time() - _t0) * 1000

    # roster is mutated (clear+update) by apply_config on a config-poll
    # thread while trade-processing threads read it here — state_lock
    # makes the membership check atomic w.r.t. that clear+update pair, so a
    # trade can never see a momentarily-empty roster and get silently
    # dropped between the clear() and the update() landing.
    with state_lock:
        is_roster_wallet = bool(wallet and wallet in roster)

    if record_ticker and usd >= TICKER_MIN_USD:
        category = fetch_event_category(info.get('eventId'))
        update_ticker_wallet(db, tx_hash, wallet, wallet_name, is_roster_wallet, category)

    if not is_roster_wallet:
        return
    with state_lock:
        stats['roster_matches'] += 1

    if side == 'SELL':
        result = record_exit(db, info['conditionId'], info['outcome'], wallet, float(price), usd, trade_ts)
        touch_tracked_wallet(db, wallet)
        if result:
            hold_seconds, is_scalp = result
            who = wallet_name or f'{wallet[:10]}…'
            if is_scalp:
                print(f'  [scalp] {info["title"]!r} -> {info["outcome"]}  {who} bought+sold within {hold_seconds/60:.0f}m — sold ${usd:,.0f}')
            else:
                held = f'{hold_seconds/3600:.1f}h' if hold_seconds < 86400 else f'{hold_seconds/86400:.1f}d'
                print(f'  [exit] {info["title"]!r} -> {info["outcome"]}  {who} sold ${usd:,.0f} after holding {held}')
        return

    key = (info['conditionId'], info['outcome'])
    trade_epoch = trade_ts.timestamp()
    with state_lock:
        bucket = conviction[key]
        already_hit = tiers_hit[key]
        is_first_ever = len(bucket) == 0 and SOLO_TIER not in already_hit
        bucket.append((trade_epoch, wallet, usd, float(price)))
        cutoff = trade_epoch - CONVICTION_WINDOW_SECONDS
        while bucket and bucket[0][0] < cutoff:
            bucket.pop(0)
        distinct_wallets = {w for _, w, _, _ in bucket}
        total_usd = sum(u for _, _, u, _ in bucket)
        newly_crossed = [t for t in TIERS if total_usd >= t and t not in already_hit]
        for t in newly_crossed:
            already_hit.add(t)
        if is_first_ever:
            already_hit.add(SOLO_TIER)

    record_contribution(db, key[0], key[1], wallet, wallet_name, usd, float(price), trade_ts)
    touch_tracked_wallet(db, wallet)
    meta_lookup = {key: info}
    if is_first_ever:
        record_tier_crossed(db, key[0], key[1], meta_lookup, usd, SOLO_TIER, 1, float(price), trade_ts)
        who = wallet_name or f'{wallet[:10]}…'
        print(f'  [solo pick] {info["title"]!r} -> {info["outcome"]}  {who} bought ${usd:,.0f}')
    for t in newly_crossed:
        record_tier_crossed(db, key[0], key[1], meta_lookup, total_usd, t, len(distinct_wallets), float(price), trade_ts)
        print(f'  [OPPORTUNITY] {info["title"]!r} -> {info["outcome"]}  '
              f'${total_usd:,.0f} from {len(distinct_wallets)} roster wallets (crossed ${t:,} tier)')


def process_trade_timed(*args, **kwargs):
    """Thin timing wrapper (2026-08-26) around process_trade, submitted to
    the executor instead of process_trade directly — lets us measure real
    end-to-end per-call duration under load without threading a timer
    through process_trade's several early-return points."""
    _t0 = time.time()
    try:
        process_trade(*args, **kwargs)
    finally:
        with state_lock:
            stats['process_trade_count'] += 1
            stats['process_trade_ms'] += (time.time() - _t0) * 1000


ONCHAIN_FILLS_RETENTION_SECONDS = 3600  # processed rows are only ever a debugging aid — prune like ticker
ONCHAIN_EXCHANGES = [
    '0xe2222d279d744050d28e00520010520000310f59',  # Neg Risk CTF Exchange V2
    '0xe111180000d2663c0091e4f400237545b87b996b',  # CTF Exchange V2 (regular)
]
ONCHAIN_RPC_POLL_SECONDS = 5  # Polygon's ~2s block time -> 2-3 blocks/poll, comfortably
# inside every free RPC's eth_getLogs block-range limit even under provider lag.

_last_onchain_block = {'n': None}       # module state — last block height already scanned
_onchain_fetch_in_flight = {'v': False}  # guards against an overlapping fetch if RPC calls
                                          # run long enough to still be in flight next tick


def _rpc_call(method, params, retries=2):
    """Same RPC_PROVIDERS fallback pattern as resolve_tx_sender/resolve_trade_wallet."""
    body = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params}).encode()
    for attempt in range(retries):
        for rpc in RPC_PROVIDERS:
            try:
                req = urllib.request.Request(rpc, data=body, headers={'Content-Type': 'application/json', **UA})
                with urllib.request.urlopen(req, timeout=8) as r:
                    res = json.load(r)
                if 'result' in res:
                    return res['result']
            except Exception:
                continue
        if attempt < retries - 1:
            time.sleep(0.5)
    return None


def _decode_order_filled_amounts(log):
    """Same shape as _decode_order_filled above, extended with the two
    amount fields (words[2]/words[3]) that resolve_trade_wallet never
    needed — mirrors the now-retired supabase/functions/alchemy-webhook's
    decodeOrderFilled. That webhook was matching/delivering every OrderFilled
    on both exchanges platform-wide (not just roster trades), which measured
    out to ~5B compute units/month on Alchemy's free-tier meter (confirmed
    live 2026-08-26 by extrapolating onchain_fills' real insert rate) — this
    gets identical data via eth_getLogs against free public RPCs for $0."""
    maker = '0x' + log['topics'][2][-40:]
    taker = '0x' + log['topics'][3][-40:]
    data = log['data'][2:]
    words = [data[i:i + 64] for i in range(0, len(data), 64)]
    if len(words) < 4:
        return None
    return {
        'maker': maker.lower(),
        'taker': taker.lower(),
        'side': int(words[0], 16),
        'token_id': str(int(words[1], 16)),
        'maker_amount_filled': str(int(words[2], 16)),
        'taker_amount_filled': str(int(words[3], 16)),
    }


def fetch_onchain_fills_via_rpc(db):
    """Polls eth_getLogs for new OrderFilled events on both exchange
    contracts since the last scanned block and queues them into
    onchain_fills — replaces the Alchemy webhook as this table's writer.
    poll_onchain_fills() below is unchanged: it only drains whatever's in
    the table, indifferent to how each row got there."""
    with state_lock:
        if _onchain_fetch_in_flight['v']:
            return
        _onchain_fetch_in_flight['v'] = True
    try:
        latest_hex = _rpc_call('eth_blockNumber', [])
        if latest_hex is None:
            with state_lock:
                stats['rpc_failures'] += 1
            return
        latest = int(latest_hex, 16)

        if _last_onchain_block['n'] is None:
            # First tick this process — start a few blocks back rather than
            # exactly "latest", so a fill landing between this blockNumber
            # call and the first real scan below isn't silently skipped.
            _last_onchain_block['n'] = latest - 5
            return

        from_block = _last_onchain_block['n'] + 1
        if from_block > latest:
            return  # no new blocks since last tick

        # Clamp an unbounded gap (e.g. after a long RPC outage) instead of
        # ever requesting a range a free provider would reject outright —
        # a small silent gap in that pathological case beats getting stuck
        # retrying the same oversized range forever.
        if latest - from_block > 2000:
            from_block = latest - 2000

        logs = _rpc_call('eth_getLogs', [{
            'fromBlock': hex(from_block),
            'toBlock': hex(latest),
            'address': ONCHAIN_EXCHANGES,
            'topics': [ORDER_FILLED_TOPIC],
        }])
        if logs is None:
            with state_lock:
                stats['rpc_failures'] += 1
            return  # leave _last_onchain_block where it was — retry this exact range next tick

        _last_onchain_block['n'] = latest
        if not logs:
            return

        # One eth_getBlockByNumber per unique block in this batch (header
        # only, no tx list) for a real timestamp instead of guessing — poll
        # cadence keeps this to at most a couple of extra calls per tick,
        # free on every public RPC.
        block_ts = {}
        for bn in sorted({lg['blockNumber'] for lg in logs}):
            blk = _rpc_call('eth_getBlockByNumber', [bn, False])
            if blk and blk.get('timestamp'):
                block_ts[bn] = datetime.fromtimestamp(int(blk['timestamp'], 16), tz=timezone.utc)

        rows = []
        for lg in logs:
            topics = lg.get('topics') or []
            if len(topics) != 4 or topics[0] != ORDER_FILLED_TOPIC:
                continue
            decoded = _decode_order_filled_amounts(lg)
            if not decoded:
                continue
            ts = block_ts.get(lg['blockNumber'], datetime.now(timezone.utc))
            rows.append((
                lg['transactionHash'], int(lg['logIndex'], 16),
                decoded['maker'], decoded['taker'], decoded['side'], decoded['token_id'],
                decoded['maker_amount_filled'], decoded['taker_amount_filled'], ts,
            ))
        if not rows:
            return

        db.executemany('''
            INSERT INTO onchain_fills
                (tx_hash, log_index, maker, taker, side, token_id, maker_amount_filled, taker_amount_filled, block_timestamp)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON CONFLICT (tx_hash, log_index) DO NOTHING
        ''', rows)
    finally:
        with state_lock:
            _onchain_fetch_in_flight['v'] = False


def prune_onchain_fills(db):
    cutoff = datetime.now(timezone.utc).timestamp() - ONCHAIN_FILLS_RETENTION_SECONDS
    db.execute('DELETE FROM onchain_fills WHERE processed = true AND EXTRACT(EPOCH FROM received_at) < %s', (cutoff,))


def poll_onchain_fills(db, keyed_token_info, roster, wallet_names, executor):
    """Replaces the old last_trade_price WebSocket branch as the source of
    trade discovery (see the 2026-08-26 investigation: that path measured a
    60% miss rate on rapid trade bursts even on actively-watched markets).
    fetch_onchain_fills_via_rpc() above decodes Polymarket's on-chain
    OrderFilled logs and queues them here (formerly the Alchemy webhook's
    job — moved off Alchemy 2026-08-26 after its free-tier compute-unit
    meter turned out to cost ~$2k/month at real platform-wide trade volume);
    this just turns each queued fill into the same process_trade() calls
    the WS path used to make.

    A single OrderFilled log settles a swap between exactly two parties —
    the raw log alone tells us BOTH of their actions unambiguously
    (confirmed live against real trades on 2026-08-26): whoever received
    tokenId just bought it, whoever gave it up just sold it. No lookup
    against our own trade history needed to classify buy vs. sell, unlike
    an earlier draft of this approach assumed — this fires process_trade
    twice per fill, once per party, each with that party's own correct
    wallet+side, rather than trying to infer direction from prior state.

    Price/size math verified live against Polymarket's own reported values
    for a real fill on 2026-08-26 (matched to the cent): USDC.e and
    Polymarket's outcome tokens are both 6-decimal, and which raw amount is
    USDC vs. outcome-token flips with `side` — maker_amount_filled is the
    USDC leg when the maker's order was a BUY (side=0), and the
    outcome-token leg when it was a SELL (side=1); taker_amount_filled is
    always the other leg.
    """
    rows = db.fetchall('''SELECT id, tx_hash, maker, taker, side, token_id,
            maker_amount_filled, taker_amount_filled, block_timestamp
        FROM onchain_fills WHERE processed = false ORDER BY id LIMIT 200''')
    if not rows:
        return

    ids = []
    for row_id, tx_hash, maker, taker, side, token_id, maker_amt, taker_amt, block_ts in rows:
        ids.append(row_id)
        if side == 0:  # maker's order was BUY -> maker pays USDC, receives the outcome token
            usdc_raw, token_raw = float(maker_amt), float(taker_amt)
        else:  # maker's order was SELL -> maker gives up the outcome token, receives USDC
            usdc_raw, token_raw = float(taker_amt), float(maker_amt)
        if token_raw <= 0:
            continue
        price = usdc_raw / token_raw  # decimals cancel — both legs are 6-decimal
        size = token_raw / 1_000_000

        buyer, seller = (maker, taker) if side == 0 else (taker, maker)
        # record_ticker=True only on the first (buyer) call — see process_trade's
        # docstring: a tx_hash gets exactly one ticker row, and having both
        # calls write it broke that, corrupting which wallet showed on it.
        for wallet, trade_side, record_ticker in ((buyer, 'BUY', True), (seller, 'SELL', False)):
            with state_lock:
                stats['process_trade_submitted'] += 1
            executor.submit(process_trade_timed, db, keyed_token_info, token_id, price, size,
                             trade_side, tx_hash, wallet, roster, wallet_names, block_ts, record_ticker)

    db.execute('UPDATE onchain_fills SET processed = true WHERE id = ANY(%s)', (ids,))


# ---------------- main loop ----------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--roster-size', type=int, default=ROSTER_SIZE)
    ap.add_argument('--database-url', default=os.environ.get('DATABASE_URL'))
    ap.add_argument('--workers', type=int, default=32)  # was 16 — bumped 2026-08-26 for the
    # extra volume from covering both exchange contracts (not just Neg Risk)
    # plus every roster-matched fill now needing two process_trade calls
    # (buyer + seller) instead of one
    args = ap.parse_args()

    if not args.database_url:
        raise SystemExit('DATABASE_URL not set — export it or pass --database-url '
                          '(Supabase Settings > Database > Connection string, session pooler, port 5432)')

    # 32 (2026-09-04) — matches --workers exactly, so every worker can always
    # get a connection without contention. The earlier 15-connection ceiling
    # (EMAXCONNSESSION, pool_size=18 got refused outright) turned out to be
    # Supavisor's own dashboard "Pool Size" setting for this project (Project
    # Settings > Database > Connection Pooling), not a hard plan-tier limit —
    # the Pro/Micro compute tier actually supports up to 60 direct database
    # connections. Raised that dashboard setting to 40 first, leaving 8
    # connections of headroom under it for everything else sharing this
    # pooler (PostgREST, Auth, migrations, ad-hoc scripts). Do not raise
    # pool_size here past whatever the dashboard setting currently is.
    db = Database(args.database_url, pool_size=32)

    all_users = load_all_users(db)
    config = load_config(db)  # app_settings wins over --roster-size if present — see Settings page
    print(f'Loading roster (top {config["roster_size"]} by best_pnl)...')
    roster = set()
    apply_config(config, roster, all_users)  # populates roster + sets TIERS/TICKER_MIN_USD/SCALP_WINDOW_SECONDS
    wallet_names = build_wallet_names(all_users)
    print(f'{len(roster)} roster wallets loaded, {len(wallet_names)} known wallet names available.')

    # tiers_hit gates every mark-to-market write (both process_trade's and
    # write_price_updates') — it's an in-memory set, so without this it
    # starts empty on every restart, silently stopping price updates for
    # every already-tracked market until each one happens to get a fresh
    # top-trader trade. Confirmed live: a market that was already tracked
    # sat stale post-restart while its real price moved dramatically
    # (0.16 shown vs Polymarket's actual ~1.0 after a late-game swing) —
    # rehydrating from opportunities on startup closes that gap.
    for cond_id, outcome, tier in db.fetchall('SELECT condition_id, outcome, tier FROM opportunities'):
        tiers_hit[(cond_id, outcome)].add(tier)
    print(f'{len(tiers_hit)} already-tracked condition/outcome pairs rehydrated for mark-to-market.')

    for cond_id, outcome in db.fetchall(
        'SELECT DISTINCT condition_id, outcome FROM opportunity_wallets WHERE market_closed = true'):
        resolved_markets.add((cond_id, outcome))
    print(f'{len(resolved_markets)} already-resolved condition/outcome pairs rehydrated (mark-to-market writes blocked for these).')

    executor = ThreadPoolExecutor(max_workers=args.workers)

    print('Fetching active market/token universe...')
    tokens, token_info = fetch_active_tokens()
    print(f'{len(tokens)} tokens across active markets.')
    keyed_token_info = {tid: info for tid, info in token_info.items()}
    dump_watched_markets(token_info)

    last_market_refresh = time.time()
    last_heartbeat = time.time()
    last_prune = time.time()
    last_onchain_prune = time.time()
    last_onchain_poll = 0.0  # fire once on startup, not just after the first interval
    last_onchain_rpc_fetch = 0.0  # fire once on startup, not just after the first interval
    last_resolution_sweep = time.time()
    last_config_reload = time.time()
    last_balance_refresh = 0.0  # fire once on startup, not just after the first interval
    last_aggregate_refresh = 0.0  # fire once on startup, not just after the first interval
    last_leaderboard_refresh = 0.0  # fire once on startup, not just after the first interval
    last_wallet_category_refresh = 0.0  # fire once on startup, not just after the first interval
    last_warm_search = 0.0  # fire once on startup, not just after the first interval
    last_broadcast_flush = time.time()

    last_activity['ts'] = time.time()
    threading.Thread(target=watchdog, daemon=True).start()

    while True:
        try:
            print('Connecting to market WebSocket...')
            ssock = ws_connect()
            sub = json.dumps({'assets_ids': tokens, 'type': 'market'}).encode()
            send_frame(ssock, sub)
            print(f'Subscribed to {len(tokens)} tokens. Listening...')
            buf = bytearray()
            last_ping = time.time()

            while True:
                now = time.time()
                last_activity['ts'] = now
                if now - last_ping > 10:
                    send_frame(ssock, b'PING')
                    last_ping = now

                if now - last_market_refresh > MARKET_REFRESH_SECONDS:
                    print('Refreshing active market/token universe...')
                    last_market_refresh = now  # reset unconditionally — previously only reset on the no-op path, so a
                    # successful refresh (the normal case) left this stale and the next loop iteration saw the same
                    # elapsed time as still over threshold, triggering another refresh immediately — a tight reconnect
                    # loop that never spent enough time actually listening to catch any trades.
                    new_tokens, new_info = fetch_active_tokens()
                    if new_tokens:
                        tokens[:] = new_tokens
                        keyed_token_info.clear()
                        keyed_token_info.update(new_info)
                        dump_watched_markets(new_info)
                        print(f'{len(tokens)} tokens — reconnecting to apply.')
                        break  # break inner loop -> reconnect with fresh subscription

                if now - last_heartbeat > HEARTBEAT_SECONDS:
                    with state_lock:
                        n_opps = sum(len(v) for v in tiers_hit.values())
                        avg_trade_ms = stats['process_trade_ms'] / stats['process_trade_count'] if stats['process_trade_count'] else 0
                        avg_profile_ms = stats['profile_fetch_ms'] / stats['profile_fetch_count'] if stats['profile_fetch_count'] else 0
                        in_flight = stats['process_trade_submitted'] - stats['process_trade_count']
                        old_est, sends = stats['old_message_estimate'], stats['broadcast_sends']
                        reduction = f'{(1 - sends / old_est) * 100:.1f}%' if old_est else 'n/a'
                        print(f'[heartbeat] trades_seen={stats["trades_seen"]} '
                              f'roster_matches={stats["roster_matches"]} '
                              f'tier_crossings={n_opps} rpc_failures={stats["rpc_failures"]} '
                              f'ticker_trades={stats["ticker_trades"]} '
                              f'price_change_seen={stats["price_change_seen"]} '
                              f'book_seen={stats["book_seen"]} '
                              f'other_events_seen={stats["other_events_seen"]} '
                              f'avg_process_trade_ms={avg_trade_ms:.1f} (n={stats["process_trade_count"]}) '
                              f'avg_profile_fetch_ms={avg_profile_ms:.1f} '
                              f'(n={stats["profile_fetch_count"]}, cache_hits={stats["profile_fetch_cache_hits"]}) '
                              f'executor_in_flight={in_flight} '
                              f'old_message_estimate={old_est} broadcast_sends={sends} reduction={reduction}')
                    last_heartbeat = now

                if now - last_prune > 600:  # every 10 min, keep the high-volume ticker table bounded
                    prune_ticker(db)
                    last_prune = now

                if now - last_onchain_prune > 600:  # every 10 min, keep onchain_fills bounded — see prune_ticker
                    prune_onchain_fills(db)
                    last_onchain_prune = now

                if now - last_onchain_rpc_fetch > ONCHAIN_RPC_POLL_SECONDS:  # populates onchain_fills — see fetch_onchain_fills_via_rpc's docstring
                    executor.submit(fetch_onchain_fills_via_rpc, db)  # makes several blocking HTTP calls — off the main loop, like sweep_resolved_positions below
                    last_onchain_rpc_fetch = now

                if now - last_onchain_poll > 1:  # trade discovery — replaces the old last_trade_price WS branch
                    poll_onchain_fills(db, keyed_token_info, roster, wallet_names, executor)
                    last_onchain_poll = now

                if now - last_resolution_sweep > 300:  # every 5 min — catches positions closed out by market resolution, not a sale
                    executor.submit(sweep_resolved_positions, db)
                    last_resolution_sweep = now

                if now - last_balance_refresh > BALANCE_REFRESH_SECONDS:  # roster wallets' USDC.e balances, for the win-rate/bet-ratio filters
                    executor.submit(refresh_wallet_balances, db, set(roster))
                    last_balance_refresh = now

                if now - last_aggregate_refresh > AGGREGATE_REFRESH_SECONDS:  # opportunities_live's precomputed best_win_rate/best_bet_ratio join
                    executor.submit(refresh_opportunity_aggregates, db)
                    last_aggregate_refresh = now

                if now - last_leaderboard_refresh > LEADERBOARD_REFRESH_SECONDS:  # leaderboard_cache
                    executor.submit(refresh_leaderboard, db)
                    last_leaderboard_refresh = now

                if now - last_wallet_category_refresh > WALLET_CATEGORY_REFRESH_SECONDS:  # wallet_category_breakdown_cache
                    executor.submit(refresh_wallet_category_breakdown, db)
                    last_wallet_category_refresh = now

                if now - last_warm_search > WARM_SEARCH_SECONDS:  # keeps wallet-search's Edge Function isolate warm
                    executor.submit(ping_wallet_search)
                    last_warm_search = now

                if now - last_config_reload > 10:  # picks up Settings-page changes without a restart
                    apply_config(load_config(db), roster, all_users)
                    last_config_reload = now

                if now - last_broadcast_flush > BROADCAST_INTERVAL_SECONDS:  # batched opportunities/ticker broadcast — see flush_dirty_broadcast()
                    executor.submit(flush_dirty_broadcast, db)
                    last_broadcast_flush = now

                # recv_frames already swallows socket.timeout internally (expected,
                # just means no data this tick) and raises ConnectionError on a real
                # disconnect, which should propagate to the outer handler to reconnect.
                frames = recv_frames(ssock, buf)

                for opcode, payload in frames:
                    if opcode == 0x1:
                        try:
                            msg = json.loads(payload)
                        except Exception:
                            continue
                        items = msg if isinstance(msg, list) else [msg]
                        for item in items:
                            et = item.get('event_type')
                            if et == 'price_change':
                                with state_lock:
                                    stats['price_change_seen'] += 1
                                # Filtered inline (cheap, no I/O) — only submits to the
                                # executor when there's an actual write to do, see
                                # filter_price_changes' docstring for why this matters
                                # at the current tracked-market count.
                                updates = filter_price_changes(keyed_token_info, item)
                                if updates:
                                    executor.submit(write_price_updates, db, updates)
                            elif et == 'book':
                                with state_lock:
                                    stats['book_seen'] += 1
                            else:
                                with state_lock:
                                    stats['other_events_seen'] += 1
                    elif opcode == 0x9:
                        send_frame(ssock, payload, opcode=0xA)
                    elif opcode == 0x8:
                        raise ConnectionError('server sent close frame')

        except Exception as e:
            print(f'Connection error: {e}. Reconnecting in 5s...')
            time.sleep(5)
            last_market_refresh = time.time()


if __name__ == '__main__':
    main()
