// Creates a Stripe Checkout Session for a subscription and hands back the
// hosted checkout URL for the frontend to redirect to. Calls Stripe's REST
// API directly via fetch (Basic Auth with the secret key) rather than
// pulling in the stripe SDK — one less dependency to worry about in Deno,
// and the request shape here is simple enough not to need it.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}

// Only these price IDs are ever accepted — never trust a client-supplied
// amount, and this also blocks someone passing an arbitrary Stripe price ID
// (e.g. someone else's product) through this endpoint.
const ALLOWED_PRICE_IDS = new Set([
  Deno.env.get('STRIPE_PRICE_PRO_MONTHLY'),
  Deno.env.get('STRIPE_PRICE_PRO_YEARLY'),
  Deno.env.get('STRIPE_PRICE_ELITE_MONTHLY'),
  Deno.env.get('STRIPE_PRICE_ELITE_YEARLY'),
].filter(Boolean))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { price_id } = await req.json()
    if (!price_id || !ALLOWED_PRICE_IDS.has(price_id)) {
      return new Response(JSON.stringify({ error: 'invalid price_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await supabase.auth.getUser()
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    // success_url must land on the app subdomain regardless of where
    // checkout was initiated (the pricing page lives on the marketing
    // domain) — APP_URL is set explicitly for that. cancel_url stays
    // origin-based since it correctly returns to wherever checkout started.
    const origin = req.headers.get('origin') || 'https://visibletrader.com'
    const appOrigin = Deno.env.get('APP_URL') || origin
    const params = new URLSearchParams({
      mode: 'subscription',
      'line_items[0][price]': price_id,
      'line_items[0][quantity]': '1',
      'subscription_data[trial_period_days]': '7',
      // client_reference_id + metadata both carry the Supabase user id through
      // to the webhook — metadata survives onto the subscription object too,
      // client_reference_id only lives on the checkout session itself.
      client_reference_id: user.id,
      'metadata[supabase_user_id]': user.id,
      'subscription_data[metadata][supabase_user_id]': user.id,
      customer_email: user.email ?? '',
      success_url: `${appOrigin}/?checkout=success`,
      cancel_url: `${origin}/pricing?checkout=cancelled`,
    })

    const stripeRes = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    })
    const session = await stripeRes.json()
    if (!stripeRes.ok) {
      return new Response(JSON.stringify({ error: session.error?.message || 'stripe error' }), {
        status: 502,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }
})
