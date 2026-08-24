// Receives Stripe subscription lifecycle events and keeps the `subscriptions`
// table in sync. Verifies the Stripe-Signature header manually via Web
// Crypto (HMAC-SHA256) instead of pulling in the stripe SDK just for that —
// same reasoning as create-checkout-session. Writes use the service role key
// so they bypass RLS; users can never reach this table directly (see the
// subscriptions migration — no insert/update policy for `authenticated`).
import { createClient } from 'jsr:@supabase/supabase-js@2'

async function verifyStripeSignature(payload: string, sigHeader: string | null, secret: string): Promise<boolean> {
  if (!sigHeader) return false
  const parts = Object.fromEntries(sigHeader.split(',').map(p => p.split('=') as [string, string]))
  const timestamp = parts['t']
  const signature = parts['v1']
  if (!timestamp || !signature) return false

  // 5-minute tolerance against replay of an old, previously-valid signature.
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false

  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`))
  const expected = Array.from(new Uint8Array(sigBuffer)).map(b => b.toString(16).padStart(2, '0')).join('')

  if (expected.length !== signature.length) return false
  let mismatch = 0
  for (let i = 0; i < expected.length; i++) mismatch |= expected.charCodeAt(i) ^ signature.charCodeAt(i)
  return mismatch === 0
}

function planFromPriceId(priceId: string | undefined): string | null {
  if (!priceId) return null
  if (priceId === Deno.env.get('STRIPE_PRICE_PRO_MONTHLY') || priceId === Deno.env.get('STRIPE_PRICE_PRO_WEEKLY')) return 'pro'
  if (priceId === Deno.env.get('STRIPE_PRICE_ELITE_MONTHLY') || priceId === Deno.env.get('STRIPE_PRICE_ELITE_YEARLY')) return 'elite'
  return null
}

Deno.serve(async (req) => {
  const payload = await req.text()
  const valid = await verifyStripeSignature(payload, req.headers.get('Stripe-Signature'), Deno.env.get('STRIPE_WEBHOOK_SECRET')!)
  if (!valid) {
    return new Response(JSON.stringify({ error: 'invalid signature' }), { status: 400 })
  }

  const event = JSON.parse(payload)
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const userId = session.client_reference_id || session.metadata?.supabase_user_id
        if (userId) {
          await supabase.from('subscriptions').upsert({
            user_id: userId,
            stripe_customer_id: session.customer,
            stripe_subscription_id: session.subscription,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' })
        }
        break
      }
      // subscription.created/updated cover trial start, renewal, plan change,
      // and past_due/unpaid — the full lifecycle after initial checkout.
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const sub = event.data.object
        const userId = sub.metadata?.supabase_user_id
        const item = sub.items?.data?.[0]
        const priceId = item?.price?.id
        // current_period_end lives on each subscription item, not the
        // subscription root, as of this account's Stripe API version —
        // confirmed by inspecting a real event payload rather than assuming.
        const periodEnd = item?.current_period_end ?? sub.current_period_end
        if (userId) {
          await supabase.from('subscriptions').upsert({
            user_id: userId,
            stripe_customer_id: sub.customer,
            stripe_subscription_id: sub.id,
            price_id: priceId,
            plan: planFromPriceId(priceId),
            status: sub.status,
            current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id' })
        }
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object
        const userId = sub.metadata?.supabase_user_id
        if (userId) {
          await supabase.from('subscriptions')
            .update({ status: 'canceled', updated_at: new Date().toISOString() })
            .eq('user_id', userId)
        }
        break
      }
    }
  } catch (err) {
    // Non-2xx makes Stripe retry with backoff — a transient DB hiccup should
    // be retried, not silently swallowed as "this event was handled".
    console.error('stripe-webhook handler error:', err)
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ received: true }), { headers: { 'content-type': 'application/json' } })
})
