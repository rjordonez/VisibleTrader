// Backs the public /search page — anyone (logged in or not) can look up a
// Polymarket wallet address. Runs as a deliberate, controlled disclosure
// gateway using the service role key: opportunity_wallets and the views
// built on it (leaderboard, wallet_positions, wallet_category_breakdown)
// are RLS-gated behind an active subscription (see
// 20260809000000_fix_rls_performance_timeout.sql), so an anon caller can't
// read any of this directly. This function decides, per-request, how much
// of that data an unentitled caller actually gets back — real headline
// stats as the hook, but position-level detail and the similar-traders
// list are never included in the response at all for a non-entitled
// caller (not just hidden client-side), so there's nothing for devtools
// to recover.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}

const ACTIVE_SUB_STATUSES = new Set(['trialing', 'active'])

interface LeaderboardRow {
  wallet: string
  wallet_name: string | null
  n: number
  won: number
  lost: number
  deployed: number
  won_usd: number
  net_profit: number
}

interface PositionRow {
  condition_id: string
  outcome: string
  title: string
  category: string | null
  usd: number
  price: number
  resolved_win: boolean
  resolved_ts: string
  profit: number
}

interface CategoryRow {
  category: string
  n: number
  won: number
  lost: number
  profit: number
}

interface SimilarTrader { wallet: string; walletName: string | null; overlap: number; netProfit: number }

// Independent of the leaderboard lookup below (which is fired in parallel
// with this, not after it) — was previously awaited sequentially before
// the leaderboard query even started, adding its full round-trip time
// (auth.getUser + a subscriptions query) to every request for nothing.
async function checkEntitled(
  supabase: ReturnType<typeof createClient>, authHeader: string | null,
): Promise<boolean> {
  if (!authHeader) return false
  const token = authHeader.replace(/^Bearer\s+/i, '')
  const { data: userData } = await supabase.auth.getUser(token)
  if (!userData.user) return false
  const { data: sub } = await supabase
    .from('subscriptions').select('status').eq('user_id', userData.user.id).maybeSingle()
  return !!sub && ACTIVE_SUB_STATUSES.has(sub.status)
}

// Other tracked wallets with positions in the same (condition_id, outcome)
// pairs this wallet has touched — the "signal" concept applied to a single
// trader instead of a live feed. Shared by both the tracked path (pairs
// sourced from our own wallet_positions) and the untracked/Polymarket
// fallback path (pairs sourced from the live positions/closed-positions
// response) — the overlap query itself only ever reads from our own
// opportunity_wallets table, so it works the same way regardless of where
// the caller's own position pairs came from.
async function findSimilarTraders(
  supabase: ReturnType<typeof createClient>,
  pairs: { condition_id: string; outcome: string }[],
  excludeWallet: string,
): Promise<SimilarTrader[]> {
  const ownPairs = new Set(pairs.map(p => `${p.condition_id}|${p.outcome}`))
  const conditionIds = [...new Set(pairs.map(p => p.condition_id))].slice(0, 50)
  if (conditionIds.length === 0) return []

  const { data: overlapRows } = await supabase
    .from('opportunity_wallets')
    .select('wallet, condition_id, outcome')
    .in('condition_id', conditionIds)
    .neq('wallet', excludeWallet)

  const overlapCounts = new Map<string, number>()
  for (const row of overlapRows ?? []) {
    if (!ownPairs.has(`${row.condition_id}|${row.outcome}`)) continue
    overlapCounts.set(row.wallet, (overlapCounts.get(row.wallet) ?? 0) + 1)
  }

  const candidateWallets = [...overlapCounts.keys()]
  if (candidateWallets.length === 0) return []

  const { data: candidateLeaderboard } = await supabase
    .from('leaderboard').select('wallet, wallet_name, net_profit').in('wallet', candidateWallets)

  return (candidateLeaderboard ?? [])
    .map(l => ({
      wallet: l.wallet as string,
      walletName: l.wallet_name as string | null,
      overlap: overlapCounts.get(l.wallet as string) ?? 0,
      netProfit: l.net_profit as number,
    }))
    .sort((a, b) => b.overlap - a.overlap || b.netProfit - a.netProfit)
    .slice(0, 5)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { wallet } = await req.json()
    if (!wallet || typeof wallet !== 'string') {
      return new Response(JSON.stringify({ error: 'wallet is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    // Service role throughout — this function IS the access-control layer
    // for this one endpoint, not RLS. See the file header comment.
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Is the caller actually entitled to the full (proprietary) view? Gates
    // position-level detail and similar-traders on both branches below —
    // the raw Polymarket live-data fallback itself is public regardless of
    // who's asking, but which of *our* tracked wallets overlap with it is
    // still our own signal either way. Run alongside the leaderboard
    // lookup (independent of each other) rather than before it.
    const [entitled, { data: summary }] = await Promise.all([
      checkEntitled(supabase, req.headers.get('Authorization')),
      supabase.from('leaderboard').select('*').ilike('wallet', wallet).maybeSingle(),
    ])

    if (!summary) {
      // Untracked wallet — same public, CORS-open Polymarket endpoints
      // TraderDetailPage.tsx's client-side fallback already uses, just
      // called server-side here for one consistent response shape. The
      // live position/trade data itself is Polymarket's own public data,
      // never gated — but which of *our* tracked wallets overlap with it
      // is our own proprietary signal, so that part still respects
      // `entitled` same as the tracked path below.
      const [posRes, closedRes, tradesRes] = await Promise.all([
        fetch(`https://data-api.polymarket.com/positions?user=${wallet}&limit=50`),
        fetch(`https://data-api.polymarket.com/closed-positions?user=${wallet}&limit=200`),
        fetch(`https://data-api.polymarket.com/trades?user=${wallet}&limit=30`),
      ])
      const [livePositions, liveClosed, liveTrades] = await Promise.all([
        posRes.ok ? posRes.json() : [],
        closedRes.ok ? closedRes.json() : [],
        tradesRes.ok ? tradesRes.json() : [],
      ])

      let similarTraders: SimilarTrader[] | null = null
      if (entitled) {
        const pairs = [...livePositions, ...liveClosed]
          .filter((p: { conditionId?: string; outcome?: string }) => p.conditionId && p.outcome)
          .map((p: { conditionId: string; outcome: string }) => ({ condition_id: p.conditionId, outcome: p.outcome }))
        similarTraders = await findSimilarTraders(supabase, pairs, wallet)
      }

      return new Response(JSON.stringify({
        tracked: false, wallet, walletName: null, entitled,
        headline: null, positions: null, categoryBreakdown: null, similarTraders,
        livePositions, liveClosed, liveTrades,
      }), { headers: { ...corsHeaders, 'content-type': 'application/json' } })
    }

    const summaryRow = summary as LeaderboardRow
    const winRate = summaryRow.won + summaryRow.lost > 0 ? (summaryRow.won / (summaryRow.won + summaryRow.lost)) * 100 : 0
    const roi = summaryRow.deployed > 0 ? (summaryRow.net_profit / summaryRow.deployed) * 100 : 0
    const { data: rank } = await supabase.rpc('wallet_pnl_rank', { target_wallet: wallet })

    const headline = {
      netProfit: summaryRow.net_profit,
      winRate,
      roi,
      resolvedCount: summaryRow.n,
      rank: typeof rank === 'number' ? rank : null,
    }

    if (!entitled) {
      return new Response(JSON.stringify({
        tracked: true, wallet, walletName: summaryRow.wallet_name, entitled: false,
        headline, positions: null, categoryBreakdown: null, similarTraders: null,
      }), { headers: { ...corsHeaders, 'content-type': 'application/json' } })
    }

    const [positionsRes, categoryRes] = await Promise.all([
      supabase.from('wallet_positions').select('*').ilike('wallet', wallet).eq('market_closed', true).order('resolved_ts', { ascending: false }),
      supabase.from('wallet_category_breakdown').select('*').ilike('wallet', wallet).order('profit', { ascending: false }),
    ])
    const positions = (positionsRes.data ?? []) as PositionRow[]
    const categoryBreakdown = (categoryRes.data ?? []) as CategoryRow[]

    const similarTraders = await findSimilarTraders(supabase, positions, wallet)

    return new Response(JSON.stringify({
      tracked: true, wallet, walletName: summaryRow.wallet_name, entitled: true,
      headline, positions, categoryBreakdown, similarTraders,
    }), { headers: { ...corsHeaders, 'content-type': 'application/json' } })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 502,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }
})
