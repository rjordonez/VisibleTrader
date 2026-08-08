// Replaces signals-proxy.mjs's /opportunities/:id/:outcome/chart route — the
// one piece of that proxy that wasn't a DB query, but a live call out to
// Polymarket. Ported as-is (same resolveTokenId + prices-history logic),
// just running on Supabase's infrastructure instead of the user's Mac so the
// frontend can reach it without a local server being reachable.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const UA = { 'User-Agent': 'Mozilla/5.0' }
const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}

async function lookupMarket(slug: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`, { headers: UA })
  const rows = res.ok ? await res.json() : []
  if (rows.length) return rows[0]
  // gamma-api's default markets lookup only returns *open* markets — a
  // resolved market (very often exactly what ends up as the highest-
  // conviction signal, since resolved games accumulate the most historical
  // volume) returns empty here and needs the explicit closed=true lookup.
  const closedRes = await fetch(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}&closed=true`, { headers: UA })
  const closedRows = closedRes.ok ? await closedRes.json() : []
  return closedRows[0] ?? null
}

async function resolveTokenId(slug: string, outcome: string): Promise<string | null> {
  const m = await lookupMarket(slug)
  if (!m) return null
  let outcomes = m.outcomes
  let tokenIds = m.clobTokenIds
  if (typeof outcomes === 'string') outcomes = JSON.parse(outcomes)
  if (typeof tokenIds === 'string') tokenIds = JSON.parse(tokenIds)
  const idx = ((outcomes as string[]) || []).indexOf(outcome)
  if (idx === -1 || !tokenIds || !(tokenIds as string[])[idx]) return null
  return (tokenIds as string[])[idx]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { condition_id, outcome } = await req.json()
    if (!condition_id || !outcome) {
      return new Response(JSON.stringify({ history: [] }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    // opportunities' RLS now requires an active subscription
    // (has_active_subscription()) — forward the caller's own auth header
    // so that check runs against who's *actually* asking, same as every
    // other endpoint that touches gated data. Not service role: that
    // would bypass the subscription check entirely instead of enforcing
    // it, handing chart data to anyone with just the public anon key. No
    // header, or no active subscription, means this query naturally
    // returns zero rows — the existing "no price history" empty state
    // below already covers that case, no separate check needed.
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ history: [] }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data } = await supabase
      .from('opportunities')
      .select('slug')
      .eq('condition_id', condition_id)
      .limit(1)
      .maybeSingle()

    const slug = data?.slug
    if (!slug) {
      return new Response(JSON.stringify({ history: [] }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    const tokenId = await resolveTokenId(slug, outcome)
    if (!tokenId) {
      return new Response(JSON.stringify({ history: [] }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    const histRes = await fetch(
      `https://clob.polymarket.com/prices-history?market=${tokenId}&interval=max&fidelity=30`,
      { headers: UA }
    )
    const histData = histRes.ok ? await histRes.json() : { history: [] }

    return new Response(JSON.stringify({ history: histData.history || [] }), {
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 502,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }
})
