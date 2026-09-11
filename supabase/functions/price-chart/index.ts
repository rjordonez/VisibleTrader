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
const ACTIVE_SUB_STATUSES = new Set(['trialing', 'active'])

async function lookupMarket(slug: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}`, { headers: UA })
  if (!res.ok) throw new Error('Market lookup failed')
  const rows = await res.json()
  if (rows.length) return rows[0]
  // gamma-api's default markets lookup only returns *open* markets — a
  // resolved market (very often exactly what ends up as the highest-
  // conviction signal, since resolved games accumulate the most historical
  // volume) returns empty here and needs the explicit closed=true lookup.
  const closedRes = await fetch(`https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}&closed=true`, { headers: UA })
  if (!closedRes.ok) throw new Error('Market lookup failed')
  const closedRows = await closedRes.json()
  return closedRows[0] ?? null
}

function resolveTokenId(m: Record<string, unknown> | null, outcome: string): string | null {
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
    const { condition_id, outcome, image_only } = await req.json()
    if (!condition_id || !outcome) {
      return new Response(JSON.stringify({ history: [], error: 'Market data could not be loaded' }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    // The market icon is cosmetic (often a generic, shared image) — free
    // for anyone, including a signed-in-but-unsubscribed visitor's locked
    // ExpertPickCard (see ExpertPickCard.tsx), same as the rest of Profit
    // Bot's public teaser data. Looked up with the service role so it
    // doesn't depend on the caller having an active subscription; only the
    // price history below still requires one — checked explicitly now,
    // since it used to ride on this same lookup's RLS and that lookup is
    // unconditional here.
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data } = await serviceClient
      .from('opportunities')
      .select('slug')
      .eq('condition_id', condition_id)
      .limit(1)
      .maybeSingle()

    let slug = data?.slug
    // Discover includes recent trades that may not yet be an opportunity.
    if (!slug) {
      const { data: trade } = await serviceClient.from('ticker').select('slug')
        .eq('condition_id', condition_id).limit(1).maybeSingle()
      slug = trade?.slug
    }
    if (!slug) {
      return new Response(JSON.stringify({ history: [], error: 'Market data could not be loaded' }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    const market = await lookupMarket(slug)
    const image = [market?.icon, market?.image].find(value => typeof value === 'string' && value.startsWith('https://')) ?? null
    if (image_only) {
      return new Response(JSON.stringify({ image }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    // Price history is the real product — still requires an active
    // subscription, checked directly against the caller's own auth now
    // that the slug/image lookup above no longer implies it.
    const authHeader = req.headers.get('Authorization')
    let active = false
    if (authHeader) {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authHeader } } },
      )
      const { data: { user } } = await supabase.auth.getUser()
      if (user) {
        const { data: sub } = await supabase.from('subscriptions').select('status').maybeSingle()
        active = !!sub && ACTIVE_SUB_STATUSES.has(sub.status)
      }
    }
    if (!active) {
      return new Response(JSON.stringify({ history: [], image, error: 'Market data could not be loaded' }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    const tokenId = resolveTokenId(market, outcome)
    if (!tokenId) {
      return new Response(JSON.stringify({ history: [], image, error: 'Outcome lookup failed' }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    // Preserve the thumbnail even when the price-history provider is unavailable.
    let history = []
    let error: string | null = null
    try {
      const histRes = await fetch(
        `https://clob.polymarket.com/prices-history?market=${tokenId}&interval=max&fidelity=30`,
        { headers: UA }
      )
      if (!histRes.ok) throw new Error('Price provider unavailable')
      const histData = await histRes.json()
      if (!Array.isArray(histData.history)) throw new Error('Invalid price history')

      history = histData.history || []
    } catch { error = 'Price history request failed' }

    return new Response(JSON.stringify({ history, image, error }), {
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 502,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }
})
