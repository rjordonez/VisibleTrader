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

async function resolveTokenId(slug: string, outcome: string): Promise<string | null> {
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
  return tokenIds[idx]
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

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!)
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
