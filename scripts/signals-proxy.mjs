import http from 'http'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'
import pg from 'pg'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ENV_PATH = path.join(__dirname, '..', '.env')
if (existsSync(ENV_PATH)) process.loadEnvFile(ENV_PATH)

const CONFIG_PATH = path.join(__dirname, '..', 'venter_config.json')
const PORT = 5201

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL not set — add it to .env (Supabase Settings > Database > Connection string)')
}
// pg returns numeric/int8 columns as strings by default (avoids precision loss
// for values past Number.MAX_SAFE_INTEGER) — nothing here gets remotely close
// to that, and every query result below feeds straight into frontend math
// (r.won / (r.won + r.lost), etc.) that assumes real numbers, so parse both
// back to JS numbers at the driver level rather than patching every call site.
pg.types.setTypeParser(20, val => parseInt(val, 10))   // int8 (COUNT(*), bigint ids)
pg.types.setTypeParser(1700, val => parseFloat(val))   // numeric (money columns)
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })

const CONFIG_DEFAULTS = {
  roster_size: 500,
  tiers: [1000, 5000, 20000, 50000, 100000],
  ticker_min_usd: 100,
  scalp_window_minutes: 30,
}

function readConfig() {
  if (!existsSync(CONFIG_PATH)) return { ...CONFIG_DEFAULTS }
  try {
    const raw = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
    return { ...CONFIG_DEFAULTS, ...raw }
  } catch {
    return { ...CONFIG_DEFAULTS }
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', chunk => { body += chunk })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

const UA = { 'User-Agent': 'Mozilla/5.0' }
const tokenIdCache = new Map() // `${slug}::${outcome}` -> clob token id — outcomes never change once a market exists

async function resolveTokenId(slug, outcome) {
  const key = `${slug}::${outcome}`
  if (tokenIdCache.has(key)) return tokenIdCache.get(key)
  const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`, { headers: UA })
  if (!res.ok) return null
  const rows = await res.json()
  if (!rows.length) return null
  const m = rows[0]
  let outcomes = m.outcomes
  let tokenIds = m.clobTokenIds
  if (typeof outcomes === 'string') outcomes = JSON.parse(outcomes)
  if (typeof tokenIds === 'string') tokenIds = JSON.parse(tokenIds)
  const idx = (outcomes || []).indexOf(outcome)
  if (idx === -1 || !tokenIds || !tokenIds[idx]) return null
  const tokenId = tokenIds[idx]
  tokenIdCache.set(key, tokenId)
  return tokenId
}

// Escapes a value for safe interpolation inside a single-quoted SQL string
// literal — every query in this file builds SQL text (not $1-style bound
// params), so this is the only thing standing between a URL path param and
// SQL injection now that queries go to a real network DB instead of a local
// trusted file. (Real parameterization is a fast-follow, not a blocker for
// MVP1 — see the migration plan.)
function sqlEscape(value) {
  return String(value).replace(/'/g, "''")
}

async function runQuery(sql) {
  const result = await pool.query(sql)
  return result.rows
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(data))
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, OPTIONS',
      'access-control-allow-headers': '*',
    })
    res.end()
    return
  }

  const url = new URL(req.url ?? '/', 'http://localhost')

  try {
    if (url.pathname === '/opportunities') {
      // wallet_count/cumulative_usd on `opportunities` are a snapshot frozen at the
      // moment the row's tier was crossed — they don't update again until the NEXT
      // tier crossing, so they go stale (sometimes badly) between crossings while
      // wallets keep contributing. Compute both live from opportunity_wallets instead
      // of trusting the frozen columns.
      // total_profit mirrors the per-trader math used in the drill-down chart:
      // resolved -> exact payout; exited/scalped -> real exit price; still holding ->
      // mark-to-market against the market's current price (lp.cur_price, looked up
      // from the same max-tier row `latest_price` used for the card's own Price stat).
      const rows = await runQuery(`
        SELECT o.id, o.condition_id, o.outcome, o.slug, o.title, o.tier, o.first_seen, o.last_updated, o.latest_price, o.category,
          COALESCE(w.live_wallet_count, o.wallet_count) AS wallet_count,
          COALESCE(w.live_total_usd, o.cumulative_usd) AS cumulative_usd,
          COALESCE(w.entries, 0) AS entries,
          COALESCE(w.exited, 0) AS exited,
          COALESCE(w.scalped, 0) AS scalped,
          COALESCE(w.closed, 0) AS closed,
          COALESCE(w.won, 0) AS won,
          COALESCE(w.lost, 0) AS lost,
          COALESCE(w.total_profit, 0) AS total_profit
        FROM opportunities o
        INNER JOIN (
          SELECT condition_id, outcome, MAX(tier) AS max_tier
          FROM opportunities GROUP BY condition_id, outcome
        ) m ON o.condition_id = m.condition_id AND o.outcome = m.outcome AND o.tier = m.max_tier
        LEFT JOIN (
          SELECT ow.condition_id, ow.outcome,
            COUNT(*) AS entries,
            COUNT(DISTINCT ow.wallet) AS live_wallet_count,
            SUM(ow.usd) AS live_total_usd,
            SUM(CASE WHEN ow.exit_ts IS NOT NULL THEN 1 ELSE 0 END) AS exited,
            SUM(CASE WHEN ow.is_scalp = true THEN 1 ELSE 0 END) AS scalped,
            SUM(CASE WHEN ow.market_closed = true THEN 1 ELSE 0 END) AS closed,
            SUM(CASE WHEN ow.market_closed = true AND ow.resolved_win = true THEN 1 ELSE 0 END) AS won,
            SUM(CASE WHEN ow.market_closed = true AND ow.resolved_win = false THEN 1 ELSE 0 END) AS lost,
            SUM(
              CASE
                WHEN ow.market_closed = true THEN
                  CASE WHEN ow.resolved_win = true THEN (ow.usd / ow.price) - ow.usd ELSE -ow.usd END
                WHEN ow.exit_ts IS NOT NULL AND ow.exit_price IS NOT NULL THEN
                  (ow.usd / ow.price) * ow.exit_price - ow.usd
                ELSE
                  (ow.usd / ow.price) * COALESCE(lp.cur_price, ow.price) - ow.usd
              END
            ) AS total_profit
          FROM opportunity_wallets ow
          LEFT JOIN (
            SELECT o2.condition_id, o2.outcome, o2.latest_price AS cur_price
            FROM opportunities o2
            INNER JOIN (SELECT condition_id, outcome, MAX(tier) AS max_tier FROM opportunities GROUP BY condition_id, outcome) m2
              ON o2.condition_id = m2.condition_id AND o2.outcome = m2.outcome AND o2.tier = m2.max_tier
          ) lp ON lp.condition_id = ow.condition_id AND lp.outcome = ow.outcome
          GROUP BY ow.condition_id, ow.outcome
        ) w ON o.condition_id = w.condition_id AND o.outcome = w.outcome
        ORDER BY o.last_updated DESC
      `)
      sendJson(res, 200, rows)
      return
    }

    if (url.pathname === '/ticker') {
      const rows = await runQuery(`
        SELECT id, condition_id, outcome, slug, title, usd, price, side, wallet, wallet_name, roster_tagged, category, ts
        FROM ticker ORDER BY epoch DESC LIMIT 200
      `)
      sendJson(res, 200, rows)
      return
    }

    if (url.pathname === '/profits') {
      const [summaryRows, dailyRows, detailRows] = await Promise.all([
        runQuery(`
          SELECT
            COUNT(*) AS resolved_n,
            SUM(CASE WHEN resolved_win = true THEN 1 ELSE 0 END) AS won,
            SUM(CASE WHEN resolved_win = false THEN 1 ELSE 0 END) AS lost,
            SUM(usd) AS deployed,
            SUM(CASE WHEN resolved_win = true THEN (usd / price) - usd ELSE -usd END) AS net_profit
          FROM opportunity_wallets WHERE market_closed = true
        `),
        runQuery(`
          SELECT resolved_ts::date AS d,
            SUM(CASE WHEN resolved_win = true THEN (usd / price) - usd ELSE -usd END) AS day_profit
          FROM opportunity_wallets WHERE market_closed = true
          GROUP BY d ORDER BY d ASC
        `),
        runQuery(`
          SELECT ow.wallet, ow.wallet_name, o.title, ow.outcome, ow.usd, ow.price, ow.resolved_win, ow.resolved_ts,
            CASE WHEN ow.resolved_win = true THEN (ow.usd / ow.price) - ow.usd ELSE -ow.usd END AS profit
          FROM opportunity_wallets ow
          JOIN (SELECT condition_id, outcome, MAX(title) AS title FROM opportunities GROUP BY condition_id, outcome) o
            ON o.condition_id = ow.condition_id AND o.outcome = ow.outcome
          WHERE ow.market_closed = true
          ORDER BY ow.resolved_ts DESC LIMIT 200
        `),
      ])
      sendJson(res, 200, { summary: summaryRows[0] ?? null, daily: dailyRows, positions: detailRows })
      return
    }

    if (url.pathname === '/leaderboard') {
      const rows = await runQuery(`
        SELECT wallet, wallet_name,
          COUNT(*) AS n,
          SUM(CASE WHEN resolved_win = true THEN 1 ELSE 0 END) AS won,
          SUM(CASE WHEN resolved_win = false THEN 1 ELSE 0 END) AS lost,
          SUM(usd) AS deployed,
          SUM(CASE WHEN resolved_win = true THEN usd ELSE 0 END) AS won_usd,
          SUM(CASE WHEN resolved_win = true THEN (usd / price) - usd ELSE -usd END) AS net_profit
        FROM opportunity_wallets
        WHERE market_closed = true AND wallet IS NOT NULL
        GROUP BY wallet
        ORDER BY net_profit DESC
      `)
      sendJson(res, 200, rows)
      return
    }

    if (url.pathname === '/settings' && req.method === 'GET') {
      sendJson(res, 200, readConfig())
      return
    }

    if (url.pathname === '/settings' && req.method === 'POST') {
      const body = await readBody(req)
      let parsed
      try {
        parsed = JSON.parse(body)
      } catch {
        sendJson(res, 400, { error: 'invalid JSON body' })
        return
      }
      // Clamp/validate everything — this writes straight to a file the Python
      // backend trusts and reloads unattended, so garbage in here would silently
      // break the live pipeline rather than just fail one HTTP request.
      const tiers = Array.isArray(parsed.tiers)
        ? [...new Set(parsed.tiers.map(Number).filter(n => Number.isFinite(n) && n >= 0))].sort((a, b) => a - b)
        : CONFIG_DEFAULTS.tiers
      const cfg = {
        roster_size: Math.max(1, Math.min(2000, Math.round(Number(parsed.roster_size)) || CONFIG_DEFAULTS.roster_size)),
        tiers: tiers.length > 0 ? tiers : CONFIG_DEFAULTS.tiers,
        ticker_min_usd: Math.max(1, Math.round(Number(parsed.ticker_min_usd)) || CONFIG_DEFAULTS.ticker_min_usd),
        scalp_window_minutes: Math.max(1, Math.round(Number(parsed.scalp_window_minutes)) || CONFIG_DEFAULTS.scalp_window_minutes),
      }
      writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2))
      sendJson(res, 200, cfg)
      return
    }

    const traderMatch = url.pathname.match(/^\/trader\/([^/]+)$/)
    if (traderMatch) {
      const wallet = sqlEscape(decodeURIComponent(traderMatch[1]))
      const [summaryRows, positionRows, categoryRows] = await Promise.all([
        runQuery(`
          SELECT wallet, wallet_name,
            COUNT(*) AS n,
            SUM(CASE WHEN resolved_win = true THEN 1 ELSE 0 END) AS won,
            SUM(CASE WHEN resolved_win = false THEN 1 ELSE 0 END) AS lost,
            SUM(usd) AS deployed,
            SUM(CASE WHEN resolved_win = true THEN usd ELSE 0 END) AS won_usd,
            SUM(CASE WHEN resolved_win = true THEN (usd / price) - usd ELSE -usd END) AS net_profit
          FROM opportunity_wallets
          WHERE market_closed = true AND lower(wallet) = lower('${wallet}')
          GROUP BY wallet
        `),
        runQuery(`
          SELECT ow.usd, ow.price, ow.resolved_win, ow.resolved_ts, o.title, o.outcome, o.category,
            CASE WHEN ow.resolved_win = true THEN (ow.usd / ow.price) - ow.usd ELSE -ow.usd END AS profit
          FROM opportunity_wallets ow
          JOIN (SELECT condition_id, outcome, MAX(title) AS title, MAX(category) AS category FROM opportunities GROUP BY condition_id, outcome) o
            ON o.condition_id = ow.condition_id AND o.outcome = ow.outcome
          WHERE ow.market_closed = true AND lower(ow.wallet) = lower('${wallet}')
          ORDER BY ow.resolved_ts DESC
        `),
        runQuery(`
          SELECT COALESCE(o.category, 'other') AS category,
            COUNT(*) AS n,
            SUM(CASE WHEN ow.resolved_win = true THEN 1 ELSE 0 END) AS won,
            SUM(CASE WHEN ow.resolved_win = false THEN 1 ELSE 0 END) AS lost,
            SUM(CASE WHEN ow.resolved_win = true THEN (ow.usd / ow.price) - ow.usd ELSE -ow.usd END) AS profit
          FROM opportunity_wallets ow
          JOIN (SELECT condition_id, outcome, MAX(category) AS category FROM opportunities GROUP BY condition_id, outcome) o
            ON o.condition_id = ow.condition_id AND o.outcome = ow.outcome
          WHERE ow.market_closed = true AND lower(ow.wallet) = lower('${wallet}')
          GROUP BY category
          ORDER BY profit DESC
        `),
      ])
      sendJson(res, 200, { summary: summaryRows[0] ?? null, positions: positionRows, by_category: categoryRows })
      return
    }

    const walletsMatch = url.pathname.match(/^\/opportunities\/([^/]+)\/([^/]+)\/wallets$/)
    if (walletsMatch) {
      const conditionId = sqlEscape(decodeURIComponent(walletsMatch[1]))
      const outcome = sqlEscape(decodeURIComponent(walletsMatch[2]))
      const rows = await runQuery(`
        SELECT wallet, wallet_name, usd, price, ts, exit_ts, exit_price, exit_usd, hold_seconds, is_scalp,
          market_closed, resolved_win, resolved_ts
        FROM opportunity_wallets
        WHERE condition_id = '${conditionId}' AND outcome = '${outcome}'
        ORDER BY ts DESC
      `)
      sendJson(res, 200, rows)
      return
    }

    const chartMatch = url.pathname.match(/^\/opportunities\/([^/]+)\/([^/]+)\/chart$/)
    if (chartMatch) {
      const conditionId = sqlEscape(decodeURIComponent(chartMatch[1]))
      const outcome = decodeURIComponent(chartMatch[2])
      const slugRows = await runQuery(`SELECT slug FROM opportunities WHERE condition_id = '${conditionId}' LIMIT 1`)
      const slug = slugRows[0]?.slug
      if (!slug) {
        sendJson(res, 200, { history: [] })
        return
      }
      const tokenId = await resolveTokenId(slug, outcome)
      if (!tokenId) {
        sendJson(res, 200, { history: [] })
        return
      }
      const histRes = await fetch(
        `https://clob.polymarket.com/prices-history?market=${tokenId}&interval=max&fidelity=30`,
        { headers: UA }
      )
      const histData = histRes.ok ? await histRes.json() : { history: [] }
      sendJson(res, 200, { history: histData.history || [] })
      return
    }

    sendJson(res, 404, { error: 'not found' })
  } catch (err) {
    console.error('[signals-proxy]', err.message)
    sendJson(res, 502, { error: err.message })
  }
})

server.listen(PORT, () => console.log(`[signals-proxy] running on http://localhost:${PORT}`))
