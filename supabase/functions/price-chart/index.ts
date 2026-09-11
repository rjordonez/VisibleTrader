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

    // Both the icon and the price history here are public regardless of
    // subscription now — a locked ExpertPickCard shows the real market
    // icon and a real (blurred) chart, same as its win rate/stats (see
    // ExpertPickCard.tsx). This data is Polymarket's own public price
    // history, reachable by anyone who already knows the condition_id;
    // what's actually gated is the curation — which markets the tracked
    // roster is on at all — enforced by opportunities/expert_picks_open's
    // RLS, untouched here. Uses the service role since there's no caller
    // entitlement left to check for this lookup.
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
