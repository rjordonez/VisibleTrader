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
  Deno.env.get('STRIPE_PRICE_PRO_WEEKLY'),
  Deno.env.get('STRIPE_PRICE_ELITE_MONTHLY'),
  Deno.env.get('STRIPE_PRICE_ELITE_YEARLY'),
].filter(Boolean))

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const { price_id, gift } = await req.json()
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

    // Without this, a double-click or a revisit to pricing while already
    // subscribed creates a second Stripe subscription for the same person
    // — Stripe would bill both, but the subscriptions table is unique on
    // user_id, so the second webhook write silently overwrites the first,
    // orphaning it in Stripe with no local record.
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: existing } = await serviceClient
      .from('subscriptions')
      .select('status')
      .eq('user_id', user.id)
      .maybeSingle()
    if (existing && (existing.status === 'trialing' || existing.status === 'active')) {
      return new Response(JSON.stringify({ error: 'already subscribed' }), {
        status: 400,
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
    // Pro's only price is billed weekly at $40, with a one-time $39 coupon
    // (duration: 'once' in Stripe, so it only ever discounts the very first
    // invoice) bringing that first charge down to $1 — replaces the old
    // free-trial model with "$1 for week one, $40/week after." Any other
    // price (e.g. Elite, if it ever gets real self-serve checkout) keeps
    // the standard 7-day free trial instead.
    //
    // gift=true (set only when checkout was started via a ?gift=1 link, see
    // giftOffer.ts) swaps in the 100%-off version of that same coupon
    // instead — first week free rather than $1, same $40/week after.
    // Stripe's Checkout API doesn't support both a pre-applied `discounts`
    // entry and customer-facing promo-code entry (allow_promotion_codes) on
    // the same session, so this is a server-decided swap, not something the
    // customer types in themselves.
    if (price_id === Deno.env.get('STRIPE_PRICE_PRO_WEEKLY')) {
      const coupon = gift === true
        ? Deno.env.get('STRIPE_COUPON_GIFT_FIRST_WEEK')!
        : Deno.env.get('STRIPE_COUPON_FIRST_WEEK')!
      params.set('discounts[0][coupon]', coupon)
    } else {
      params.set('subscription_data[trial_period_days]', '7')
    }

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
