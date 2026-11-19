// Immediately cancels a *trialing* subscription — deliberately separate from
// the Stripe Billing Portal's own cancel button (which we leave configured
// as at_period_end for paid subscribers, so they keep access through what
// they already paid for). This endpoint refuses to touch anything that
// isn't currently trialing, specifically to prevent it being used as a
// backdoor immediate-cancel for paid periods.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { membershipRow, membershipStatus, whopConfig, whopFetch } from '../_shared/whop.ts'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await supabaseAuth.auth.getUser()
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: sub } = await supabase
      .from('subscriptions')
      .select('stripe_subscription_id, status, provider, whop_membership_id')
      .eq('user_id', user.id)
      .maybeSingle()

    // Whop customers. During the $1 trial: cancel immediately (access ends now
    // and the $160 is never charged), matching the Stripe trial cancel. After
    // a full-price charge: cancel at period end so they keep what they paid
    // for, with { undo: true } to reverse it. Whop's cancel is immediate unless
    // cancel_at_period_end: true is sent, so both cases pass it explicitly.
    if (sub?.provider === 'whop' && sub.whop_membership_id) {
      const whop = whopConfig((name) => Deno.env.get(name))
      if (!whop) throw new Error('whop not configured')
      const body = await req.json().catch(() => ({})) as { undo?: boolean }
      const before = await whopFetch(whop, `/memberships/${sub.whop_membership_id}`)
      const inTrial = membershipStatus(before) === 'trialing'
      if (body.undo) {
        await whopFetch(whop, `/memberships/${sub.whop_membership_id}`, { method: 'PATCH', body: { cancel_at_period_end: false } })
      } else {
        await whopFetch(whop, `/memberships/${sub.whop_membership_id}/cancel`, {
          method: 'POST',
          body: { cancel_at_period_end: !inTrial, reason: 'Canceled from Visible Trader settings' },
        })
      }
      const m = await whopFetch(whop, `/memberships/${sub.whop_membership_id}`)
      const row = membershipRow(m)
      // An immediate trial cancel must lock the app now, even if Whop still
      // reports the membership as active for a moment.
      if (!body.undo && inTrial) row.status = 'canceled'
      const { error: rowError } = await supabase.from('subscriptions')
        .update(row).eq('user_id', user.id).eq('whop_membership_id', sub.whop_membership_id)
      if (rowError) throw rowError
      return new Response(JSON.stringify({ canceled: !body.undo, immediate: !body.undo && inTrial, cancel_at_period_end: !!m.cancel_at_period_end, provider: 'whop' }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    if (!sub?.stripe_subscription_id) {
      return new Response(JSON.stringify({ error: 'no subscription on file' }), {
        status: 404,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }
    // The local row can lag the renewal webhook. Check Stripe before deleting
    // so an already-paid monthly period cannot be canceled as an old trial.
    const currentResponse = await fetch(`https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`, {
      headers: { Authorization: `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}` },
    })
    const current = await currentResponse.json()
    if (!currentResponse.ok) throw new Error(current.error?.message || 'Could not verify subscription')
    if (current.status !== 'trialing') {
      return new Response(JSON.stringify({ error: 'not currently trialing — use the billing portal to manage a paid subscription' }), {
        status: 400,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    const stripeRes = await fetch(`https://api.stripe.com/v1/subscriptions/${sub.stripe_subscription_id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}` },
    })
    const result = await stripeRes.json()
    if (!stripeRes.ok) {
      return new Response(JSON.stringify({ error: result.error?.message || 'stripe error' }), {
        status: 502,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    // Update now for an instant UI result — the customer.subscription.deleted
    // webhook will also land shortly after and confirm the same state.
    const { error: updateError } = await supabase.from('subscriptions')
      .update({ status: 'canceled', updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('stripe_subscription_id', sub.stripe_subscription_id)
    if (updateError) throw updateError

    return new Response(JSON.stringify({ canceled: true }), {
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }
})
