// Creates a Stripe Checkout Session for a subscription and hands back the
// hosted checkout URL for the frontend to redirect to. Calls Stripe's REST
// API directly via fetch (Basic Auth with the secret key) rather than
// pulling in the stripe SDK — one less dependency to worry about in Deno,
// and the request shape here is simple enough not to need it.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { blockedBrandParams, checkoutLineItems, MONTHLY_INTRO_OFFER, threeDSTestParams } from './checkout.ts'
import { chooseProvider, splitPercent, whopConfig, whopFetch } from '../_shared/whop.ts'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    let lineItems: URLSearchParams
    let input: { offer?: string; price_id?: string } = {}
    try {
      input = await req.json()
      lineItems = checkoutLineItems(input, {
        monthlyPrice: Deno.env.get('STRIPE_PRICE_PRO_MONTHLY'),
        introPrice: Deno.env.get('STRIPE_PRICE_PRO_INTRO_WEEK'),
        weeklyPrice: Deno.env.get('STRIPE_PRICE_PRO_WEEKLY'),
        weeklyCoupon: Deno.env.get('STRIPE_COUPON_FIRST_WEEK'),
        eliteMonthlyPrice: Deno.env.get('STRIPE_PRICE_ELITE_MONTHLY'),
        eliteYearlyPrice: Deno.env.get('STRIPE_PRICE_ELITE_YEARLY'),
        legacyCheckoutEnabled: Deno.env.get('STRIPE_LEGACY_CHECKOUT_ENABLED') === 'true',
      })
    } catch (error) {
      return new Response(JSON.stringify({ error: (error as Error).message }), {
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
    const { data: existing, error: subscriptionError } = await serviceClient
      .from('subscriptions')
      .select('status')
      .eq('user_id', user.id)
      .maybeSingle()
    if (subscriptionError) throw subscriptionError
    if (existing && (existing.status === 'trialing' || existing.status === 'active')) {
      return new Response(JSON.stringify({ error: 'already subscribed' }), {
        status: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    // Attribution is frozen in the database, never trusted from request data or
    // editable user metadata. Refuse checkout if signup capture has not finished.
    const { data: attribution, error: attributionError } = await serviceClient
      .from('signup_attributions').select('referral_code, finalized_at')
      .eq('user_id', user.id).single()
    if (attributionError) throw attributionError
    if (!attribution.finalized_at) throw new Error('Signup setup is not complete. Please reload and try again.')

    // success_url must land on the app subdomain regardless of where
    // checkout was initiated (the pricing page lives on the marketing
    // domain) — APP_URL is set explicitly for that. cancel_url stays
    // origin-based since it correctly returns to wherever checkout started.
    const origin = req.headers.get('origin') || 'https://visibletrader.com'
    const appOrigin = Deno.env.get('APP_URL') || origin

    // Whop split: only brand-new customers (no subscriptions row of any kind,
    // so nobody can hit Whop's "trial already used" $161 charge) buying the
    // monthly intro offer. WHOP_SPLIT_PERCENT=0 (or unset) is the kill switch:
    // everyone goes to Stripe. The first assignment is stored so a user who
    // reopens checkout lands on the same provider.
    const whop = whopConfig((name) => Deno.env.get(name))
    const percent = splitPercent(Deno.env.get('WHOP_SPLIT_PERCENT'))
    // Test accounts listed here always get Whop, even at 0%, so the flow can
    // be tested end to end without routing any real customer.
    const forcedWhop = (Deno.env.get('WHOP_FORCE_USER_IDS') ?? '').split(',').map((s) => s.trim()).includes(user.id)
    if (whop && (percent > 0 || forcedWhop) && input.offer === MONTHLY_INTRO_OFFER && !existing) {
      const { data: assigned, error: assignedError } = await serviceClient
        .from('checkout_assignments').select('provider').eq('user_id', user.id).maybeSingle()
      if (assignedError) throw assignedError
      let provider = assigned?.provider as 'stripe' | 'whop' | undefined
      if (!provider || forcedWhop) {
        provider = forcedWhop ? 'whop' : chooseProvider(user.id, percent)
        const { error: insertError } = await serviceClient.from('checkout_assignments')
          .upsert({ user_id: user.id, provider, split_percent: percent }, { onConflict: 'user_id', ignoreDuplicates: true })
        if (insertError) throw insertError
      }
      if (provider === 'whop') {
        const checkout = await whopFetch(whop, '/checkout_configurations', {
          method: 'POST',
          // One checkout per user per 10 minutes, so double-clicks reuse it.
          idempotencyKey: `vt-checkout-${user.id}-${Math.floor(Date.now() / 600_000)}`,
          body: {
            account_id: whop.accountId,
            variant_id: whop.planId,
            metadata: { supabase_user_id: user.id, referral_code: attribution.referral_code ?? '' },
            redirect_url: `${appOrigin}/?checkout=success`,
          },
        })
        if (!checkout?.purchase_url) throw new Error('Whop checkout did not return a URL')
        return new Response(JSON.stringify({ url: checkout.purchase_url, provider: 'whop' }), {
          headers: { ...corsHeaders, 'content-type': 'application/json' },
        })
      }
    }

    const params = new URLSearchParams({
      mode: 'subscription',
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
    if (attribution.referral_code) {
      params.set('metadata[referral_code]', attribution.referral_code)
      params.set('subscription_data[metadata][referral_code]', attribution.referral_code)
    }
    for (const [key, value] of lineItems) params.set(key, value)
    for (const [key, value] of blockedBrandParams()) params.set(key, value)
    // Off unless CHECKOUT_3DS_TEST=on, so deploying this changes nothing by itself.
    for (const [key, value] of threeDSTestParams(user.id, Deno.env.get('CHECKOUT_3DS_TEST') === 'on')) {
      params.set(key, value)
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
