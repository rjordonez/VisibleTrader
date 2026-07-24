#!/usr/bin/env python3
"""Live signal-detection backend: watches real-time Polymarket trades via
WebSocket, resolves each trade's on-chain sender wallet, and surfaces
capital-weighted-conviction opportunities from a tracked roster of top
traders into a local SQLite DB for a future UI to read.

Long-running process — run with `python3 scripts/live-signal-service.py` and
leave it going. Stdlib only, no new dependencies (raw-socket WebSocket client,
same pattern validated live earlier this session).
"""
import argparse, bisect, json, os, socket, sqlite3, ssl, struct, base64, threading, time, urllib.error, urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

WS_HOST = 'ws-subscriptions-clob.polymarket.com'
WS_PATH = '/ws/market'
RPC_PROVIDERS = [
    'https://polygon-bor-rpc.publicnode.com',
    'https://1rpc.io/matic',
    'https://polygon.drpc.org',
]
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
CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'venter_config.json')

lock = threading.Lock()
stats = {'trades_seen': 0, 'roster_matches': 0, 'rpc_failures': 0, 'ticker_trades': 0}
conviction = defaultdict(list)  # (conditionId, outcome) -> [(ts, wallet, usd, price), ...]
tiers_hit = defaultdict(set)    # (conditionId, outcome) -> {tiers already recorded}
event_categories = {}           # eventId -> category slug, cached (an /events/{id} call per market is too expensive to do for the whole active-token universe up front)


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
    with lock:
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

def build_roster(all_users, size=ROSTER_SIZE):
    ranked = sorted(all_users, key=lambda u: -(u['best_pnl'] if u['best_pnl'] is not None else -1e18))[:size]
    return {u['wallet'].lower() for u in ranked}


def load_config():
    """venter_config.json — written by the Settings page (via signals-proxy.mjs),
    read here on a short timer. Missing/invalid file just falls back to the
    hardcoded defaults, so this is safe even if the UI has never been used."""
    defaults = {
        'roster_size': ROSTER_SIZE,
        'tiers': list(TIERS),
        'ticker_min_usd': TICKER_MIN_USD,
        'scalp_window_minutes': SCALP_WINDOW_SECONDS // 60,
    }
    try:
        with open(CONFIG_PATH) as f:
            data = json.load(f)
        for k in defaults:
            if k in data:
                defaults[k] = data[k]
    except Exception:
        pass
    return defaults


def apply_config(cfg, roster_set, all_users):
    """Reassigning these module globals is enough — every read site (process_trade,
    record_exit, etc.) looks the name up fresh each call rather than holding a
    stale local copy, so this takes effect on the very next trade with no restart.
    roster_set is mutated in place (clear+update) rather than reassigned, since
    main() and every in-flight executor.submit closure already hold a reference
    to that exact set object."""
    global TIERS, TICKER_MIN_USD, SCALP_WINDOW_SECONDS
    TIERS = sorted(float(t) if not float(t).is_integer() else int(t) for t in cfg['tiers'])
    TICKER_MIN_USD = cfg['ticker_min_usd']
    SCALP_WINDOW_SECONDS = cfg['scalp_window_minutes'] * 60
    new_roster = build_roster(all_users, cfg['roster_size'])
    if new_roster != roster_set:
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

MARKET_FETCH_PAGE_LIMIT = 150  # 150 pages x 100 = up to 15,000 markets, volume-sorted so the
# highest-activity markets are always covered first even if we stop short of the true ~20k+ total.
# The full crawl (no cap) was observed live to stall for 20+ minutes with zero progress output —
# not worth chasing the entire long tail of near-zero-volume markets for it.

def fetch_active_tokens():
    """Returns (token_list, token_info) where token_info[token_id] =
    {conditionId, outcome, slug, title}.

    Uses the /markets/keyset cursor-based endpoint, NOT /markets?offset=... —
    the offset endpoint hard-caps around offset~2000 (returns HTTP 422:
    "offset too large, use /markets/keyset for deeper pagination") and the
    old code silently treated that error as "no more pages", which meant this
    function was quietly capping at ~2,100 of a true ~20,000+ active markets.
    Sorted by volume24hr descending and capped at MARKET_FETCH_PAGE_LIMIT pages
    so this stays fast and bounded instead of crawling the entire long tail."""
    tokens, token_info = [], {}
    cursor = None
    page = 0
    while True:
        url = ('https://gamma-api.polymarket.com/markets/keyset?limit=100&active=true&closed=false'
               '&order=volume24hr&ascending=false')
        if cursor:
            url += f'&next_cursor={cursor}'
        data = get_json(url)
        if not data:
            print(f'  (market fetch page {page} failed after retries, stopping there)')
            break
        markets = data.get('markets', [])
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
            for tid, outcome in zip(ids, outcomes):
                tokens.append(tid)
                token_info[tid] = {
                    'conditionId': m.get('conditionId'), 'outcome': outcome,
                    'slug': m.get('slug'), 'title': m.get('question') or m.get('slug'),
                    'eventId': event_id,
                }
        page += 1
        if page % 20 == 0:
            print(f'  ...fetched {page} pages, {len(tokens)} tokens so far')
        cursor = data.get('next_cursor')
        if not cursor or not markets or page >= MARKET_FETCH_PAGE_LIMIT:
            break
    return tokens, token_info


# ---------------- raw-socket WebSocket client ----------------

def ws_connect():
    key = base64.b64encode(os.urandom(16)).decode()
    req = (f'GET {WS_PATH} HTTP/1.1\r\nHost: {WS_HOST}\r\nUpgrade: websocket\r\n'
           f'Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n')
    ctx = ssl.create_default_context()
    sock = socket.create_connection((WS_HOST, 443), timeout=15)
    ssock = ctx.wrap_socket(sock, server_hostname=WS_HOST)
    ssock.send(req.encode())
    resp = b''
    while b'\r\n\r\n' not in resp:
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

def ensure_column(conn, table, column, coltype):
    """CREATE TABLE IF NOT EXISTS is a no-op on a table that already exists
    with an older schema — this handles adding a column that got introduced
    after the DB file was first created, so existing venter_signals.db files
    from earlier runs don't crash on the next INSERT/UPDATE."""
    existing = {row[1] for row in conn.execute(f'PRAGMA table_info({table})')}
    if column not in existing:
        conn.execute(f'ALTER TABLE {table} ADD COLUMN {column} {coltype}')


def init_db(path):
    conn = sqlite3.connect(path, check_same_thread=False)
    conn.execute('''CREATE TABLE IF NOT EXISTS opportunities (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        condition_id TEXT, outcome TEXT, slug TEXT, title TEXT,
        cumulative_usd REAL, tier INTEGER, wallet_count INTEGER,
        first_seen TEXT, last_updated TEXT, latest_price REAL,
        UNIQUE(condition_id, outcome, tier)
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS opportunity_wallets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        condition_id TEXT, outcome TEXT, wallet TEXT, wallet_name TEXT, usd REAL, price REAL, ts TEXT
    )''')
    conn.execute('''CREATE TABLE IF NOT EXISTS ticker (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        condition_id TEXT, outcome TEXT, slug TEXT, title TEXT,
        usd REAL, price REAL, side TEXT, tx_hash TEXT,
        wallet TEXT, wallet_name TEXT, roster_tagged INTEGER DEFAULT 0,
        ts TEXT, epoch REAL
    )''')
    ensure_column(conn, 'opportunity_wallets', 'wallet_name', 'TEXT')
    ensure_column(conn, 'opportunity_wallets', 'exit_ts', 'TEXT')
    ensure_column(conn, 'opportunity_wallets', 'exit_price', 'REAL')
    ensure_column(conn, 'opportunity_wallets', 'exit_usd', 'REAL')
    ensure_column(conn, 'opportunity_wallets', 'hold_seconds', 'REAL')
    ensure_column(conn, 'opportunity_wallets', 'is_scalp', 'INTEGER')
    ensure_column(conn, 'opportunity_wallets', 'market_closed', 'INTEGER')
    ensure_column(conn, 'opportunity_wallets', 'resolved_win', 'INTEGER')
    ensure_column(conn, 'opportunity_wallets', 'resolved_ts', 'TEXT')
    ensure_column(conn, 'ticker', 'wallet_name', 'TEXT')
    ensure_column(conn, 'ticker', 'category', 'TEXT')
    ensure_column(conn, 'opportunities', 'category', 'TEXT')
    conn.commit()
    return conn


def record_tier_crossed(conn, condition_id, outcome, token_info, cumulative_usd, tier, wallet_count, price):
    slug = title = None
    category = 'other'
    meta = token_info.get((condition_id, outcome))
    if meta:
        slug, title = meta.get('slug'), meta.get('title')
        category = fetch_event_category(meta.get('eventId'))
    now = datetime.now(timezone.utc).isoformat()
    with lock:
        conn.execute('''INSERT OR IGNORE INTO opportunities
            (condition_id, outcome, slug, title, cumulative_usd, tier, wallet_count, first_seen, last_updated, latest_price, category)
            VALUES (?,?,?,?,?,?,?,?,?,?,?)''',
            (condition_id, outcome, slug, title, cumulative_usd, tier, wallet_count, now, now, price, category))
        conn.execute('''UPDATE opportunities SET cumulative_usd=?, wallet_count=?, last_updated=?, latest_price=?, category=?
            WHERE condition_id=? AND outcome=? AND tier=?''',
            (cumulative_usd, wallet_count, now, price, category, condition_id, outcome, tier))
        conn.commit()


def record_contribution(conn, condition_id, outcome, wallet, wallet_name, usd, price):
    now = datetime.now(timezone.utc).isoformat()
    with lock:
        conn.execute('''INSERT INTO opportunity_wallets (condition_id, outcome, wallet, wallet_name, usd, price, ts)
            VALUES (?,?,?,?,?,?,?)''', (condition_id, outcome, wallet, wallet_name, usd, price, now))
        conn.commit()


def record_exit(conn, condition_id, outcome, wallet, price, usd):
    """Closes the oldest still-open contribution row for this wallet+market
    (FIFO — this is a best-effort signal classifier, not real accounting) and
    classifies the round trip as a scalp (held < SCALP_WINDOW_SECONDS) or a
    genuine exit. Returns (hold_seconds, is_scalp) or None if this wallet has
    no tracked open entry here (e.g. they sold a position opened before this
    process started watching, or before it started tracking sells at all)."""
    now_dt = datetime.now(timezone.utc)
    with lock:
        row = conn.execute('''SELECT id, ts FROM opportunity_wallets
            WHERE condition_id=? AND outcome=? AND wallet=? AND exit_ts IS NULL
            ORDER BY ts ASC LIMIT 1''', (condition_id, outcome, wallet)).fetchone()
        if not row:
            return None
        row_id, buy_ts_str = row
        buy_ts = datetime.fromisoformat(buy_ts_str).timestamp()
        hold_seconds = now_dt.timestamp() - buy_ts
        is_scalp = hold_seconds <= SCALP_WINDOW_SECONDS
        conn.execute('''UPDATE opportunity_wallets SET exit_ts=?, exit_price=?, exit_usd=?, hold_seconds=?, is_scalp=?
            WHERE id=?''', (now_dt.isoformat(), price, usd, hold_seconds, 1 if is_scalp else 0, row_id))
        conn.commit()
    return hold_seconds, is_scalp


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


def sweep_resolved_positions(conn):
    """Runs periodically (not per-trade — this is a network call per distinct open
    market, too slow to do inline). Finds every market with still-open positions,
    checks whether it has resolved, and closes out all its open rows at once."""
    with lock:
        rows = conn.execute('''SELECT DISTINCT ow.condition_id, ow.outcome, o.slug
            FROM opportunity_wallets ow
            JOIN opportunities o ON o.condition_id = ow.condition_id AND o.outcome = ow.outcome
            WHERE ow.exit_ts IS NULL AND (ow.market_closed IS NULL OR ow.market_closed = 0)''').fetchall()
    slug_results = {}
    closed_count = 0
    for condition_id, outcome, slug in rows:
        if slug not in slug_results:
            slug_results[slug] = check_market_closed(slug)
        result = slug_results[slug]
        if result is None:
            continue  # still open
        won = result.get(outcome)
        now = datetime.now(timezone.utc).isoformat()
        with lock:
            conn.execute('''UPDATE opportunity_wallets SET market_closed=1, resolved_win=?, resolved_ts=?
                WHERE condition_id=? AND outcome=? AND exit_ts IS NULL''',
                (1 if won else (0 if won is not None else None), now, condition_id, outcome))
            conn.commit()
        closed_count += 1
    if closed_count:
        print(f'  [resolved] {closed_count} market/outcome pairs closed out (positions settled by resolution, not a sale)')


def record_ticker_trade(conn, info, usd, price, side, tx_hash):
    """Inserted immediately on a big-enough trade, BEFORE on-chain wallet
    resolution — this is what makes the ticker sub-second instead of waiting
    on an RPC round trip like the roster-matched signals do."""
    now = datetime.now(timezone.utc)
    with lock:
        cur = conn.execute('''INSERT INTO ticker
            (condition_id, outcome, slug, title, usd, price, side, tx_hash, wallet, roster_tagged, ts, epoch)
            VALUES (?,?,?,?,?,?,?,?,NULL,0,?,?)''',
            (info['conditionId'], info['outcome'], info['slug'], info['title'],
             usd, price, side, tx_hash, now.isoformat(), now.timestamp()))
        conn.commit()
        return cur.lastrowid


def update_ticker_wallet(conn, ticker_id, wallet, wallet_name, roster_tagged, category):
    with lock:
        conn.execute('UPDATE ticker SET wallet=?, wallet_name=?, roster_tagged=?, category=? WHERE id=?',
                      (wallet, wallet_name, 1 if roster_tagged else 0, category, ticker_id))
        conn.commit()


def prune_ticker(conn):
    cutoff = time.time() - TICKER_RETENTION_SECONDS
    with lock:
        conn.execute('DELETE FROM ticker WHERE epoch < ?', (cutoff,))
        conn.commit()


# ---------------- signal processing ----------------

def process_trade(conn, keyed_token_info, tid, price, size, side, tx_hash, roster, wallet_names):
    if side not in ('BUY', 'SELL') or not tx_hash:
        return
    info = keyed_token_info.get(tid)
    if not info:
        return
    with lock:
        stats['trades_seen'] += 1

    usd = (float(price) if price else 0) * (float(size) if size else 0)

    # Ticker: fires on size alone, immediately, before any RPC wait — this is
    # what makes it sub-second instead of gated on wallet resolution.
    ticker_id = None
    if usd >= TICKER_MIN_USD:
        ticker_id = record_ticker_trade(conn, info, usd, float(price) if price else 0, side, tx_hash)
        with lock:
            stats['ticker_trades'] += 1

    if usd <= 0:
        return

    wallet = resolve_trade_wallet(tx_hash, tid)
    wallet_name = wallet_names.get(wallet) if wallet else None
    if wallet and not wallet_name:
        wallet_name = fetch_live_profile_name(wallet)  # not in our local 261k dataset — try live, covers anyone with a profile

    if ticker_id is not None:
        category = fetch_event_category(info.get('eventId'))
        update_ticker_wallet(conn, ticker_id, wallet, wallet_name, bool(wallet and wallet in roster), category)

    if not wallet or wallet not in roster:
        return
    with lock:
        stats['roster_matches'] += 1

    if side == 'SELL':
        result = record_exit(conn, info['conditionId'], info['outcome'], wallet, float(price), usd)
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
    now_ts = time.time()
    with lock:
        bucket = conviction[key]
        already_hit = tiers_hit[key]
        is_first_ever = len(bucket) == 0 and SOLO_TIER not in already_hit
        bucket.append((now_ts, wallet, usd, float(price)))
        cutoff = now_ts - CONVICTION_WINDOW_SECONDS
        while bucket and bucket[0][0] < cutoff:
            bucket.pop(0)
        distinct_wallets = {w for _, w, _, _ in bucket}
        total_usd = sum(u for _, _, u, _ in bucket)
        newly_crossed = [t for t in TIERS if total_usd >= t and t not in already_hit]
        for t in newly_crossed:
            already_hit.add(t)
        if is_first_ever:
            already_hit.add(SOLO_TIER)

    record_contribution(conn, key[0], key[1], wallet, wallet_name, usd, float(price))
    meta_lookup = {key: info}
    if is_first_ever:
        record_tier_crossed(conn, key[0], key[1], meta_lookup, usd, SOLO_TIER, 1, float(price))
        who = wallet_name or f'{wallet[:10]}…'
        print(f'  [solo pick] {info["title"]!r} -> {info["outcome"]}  {who} bought ${usd:,.0f}')
    for t in newly_crossed:
        record_tier_crossed(conn, key[0], key[1], meta_lookup, total_usd, t, len(distinct_wallets), float(price))
        print(f'  [OPPORTUNITY] {info["title"]!r} -> {info["outcome"]}  '
              f'${total_usd:,.0f} from {len(distinct_wallets)} roster wallets (crossed ${t:,} tier)')


# ---------------- main loop ----------------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--users', default='polymarket_users.json')
    ap.add_argument('--roster-size', type=int, default=ROSTER_SIZE)
    ap.add_argument('--db', default='venter_signals.db')
    ap.add_argument('--workers', type=int, default=16)
    args = ap.parse_args()

    all_users = json.load(open(args.users))
    config = load_config()  # venter_config.json wins over --roster-size if present — see Settings page
    print(f'Loading roster (top {config["roster_size"]} by best_pnl)...')
    roster = set()
    apply_config(config, roster, all_users)  # populates roster + sets TIERS/TICKER_MIN_USD/SCALP_WINDOW_SECONDS
    wallet_names = build_wallet_names(all_users)
    print(f'{len(roster)} roster wallets loaded, {len(wallet_names)} known wallet names available.')

    conn = init_db(args.db)
    executor = ThreadPoolExecutor(max_workers=args.workers)

    print('Fetching active market/token universe...')
    tokens, token_info = fetch_active_tokens()
    print(f'{len(tokens)} tokens across active markets.')
    keyed_token_info = {tid: info for tid, info in token_info.items()}

    last_market_refresh = time.time()
    last_heartbeat = time.time()
    last_prune = time.time()
    last_resolution_sweep = time.time()
    last_config_reload = time.time()

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
                        print(f'{len(tokens)} tokens — reconnecting to apply.')
                        break  # break inner loop -> reconnect with fresh subscription

                if now - last_heartbeat > HEARTBEAT_SECONDS:
                    with lock:
                        n_opps = sum(len(v) for v in tiers_hit.values())
                        print(f'[heartbeat] trades_seen={stats["trades_seen"]} '
                              f'roster_matches={stats["roster_matches"]} '
                              f'tier_crossings={n_opps} rpc_failures={stats["rpc_failures"]} '
                              f'ticker_trades={stats["ticker_trades"]}')
                    last_heartbeat = now

                if now - last_prune > 600:  # every 10 min, keep the high-volume ticker table bounded
                    prune_ticker(conn)
                    last_prune = now

                if now - last_resolution_sweep > 300:  # every 5 min — catches positions closed out by market resolution, not a sale
                    executor.submit(sweep_resolved_positions, conn)
                    last_resolution_sweep = now

                if now - last_config_reload > 10:  # picks up Settings-page changes without a restart
                    apply_config(load_config(), roster, all_users)
                    last_config_reload = now

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
                            if item.get('event_type') == 'last_trade_price':
                                executor.submit(
                                    process_trade, conn, keyed_token_info,
                                    item.get('asset_id'), item.get('price'), item.get('size'),
                                    item.get('side'), item.get('transaction_hash'), roster, wallet_names,
                                )
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
