// Receives Stripe subscription lifecycle events and keeps the `subscriptions`
// table in sync. Verifies the Stripe-Signature header manually via Web
// Crypto (HMAC-SHA256) instead of pulling in the stripe SDK just for that —
// same reasoning as create-checkout-session. Writes use the service role key
// so they bypass RLS; users can never reach this table directly (see the
// subscriptions migration — no insert/update policy for `authenticated`).
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { recordInvoicePayment } from './payments.ts'
import { subscriptionForAccess } from './subscription.ts'
import { sendChargeReceiptEmail } from './email.ts'

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

  const stripe = async (path: string, method = 'GET') => {
    const response = await fetch(`https://api.stripe.com/v1${path}`, {
      method,
      headers: { Authorization: `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}` },
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error?.message || 'Stripe subscription lookup failed')
    return result
  }

  const syncSubscription = async (id: string, onlyIfCurrent = false) => {
    if (onlyIfCurrent) {
      const { data, error } = await supabase.from('subscriptions')
        .select('stripe_subscription_id').eq('stripe_subscription_id', id).maybeSingle()
      if (error) throw error
      // An invoice for an old subscription must not replace a newer one.
      // Subscription and checkout events handle the initial row creation.
      if (!data) return
    }
    const sub = await subscriptionForAccess(id, stripe)
    const userId = sub.metadata?.supabase_user_id
    if (!userId) return
    // A user who now pays through Whop must not be overwritten by a late or
    // replayed event from an old Stripe subscription.
    const { data: currentRow, error: currentError } = await supabase.from('subscriptions')
      .select('provider, status').eq('user_id', userId).maybeSingle()
    if (currentError) throw currentError
    if (currentRow?.provider === 'whop' && ['trialing', 'active', 'past_due'].includes(currentRow.status ?? '')) return
    const item = sub.items?.data?.[0]
    const periodEnd = item?.current_period_end ?? sub.current_period_end
    const { error } = await supabase.from('subscriptions').upsert({
      user_id: userId,
      provider: 'stripe',
      stripe_customer_id: sub.customer,
      stripe_subscription_id: sub.id,
      price_id: item?.price?.id,
      plan: planFromPriceId(item?.price?.id),
      status: sub.status,
      stripe_livemode: sub.livemode ?? null,
      stripe_trial_started_at: sub.trial_start ? new Date(sub.trial_start * 1000).toISOString() : null,
      stripe_trial_ends_at: sub.trial_end ? new Date(sub.trial_end * 1000).toISOString() : null,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' })
    if (error) throw error
  }

  // Receipt with a refund path for full-price charges only: the first charge
  // after the trial and each renewal, never the $1 intro. Best-effort, so a
  // Resend outage can't make Stripe retry the whole event.
  type ReceiptInvoice = {
    id: string
    created: number
    billing_reason?: string | null
    amount_paid?: number
    currency?: string
    customer_email?: string | null
    status_transitions?: { paid_at?: number | null }
  }
  const sendReceipt = async (invoice: ReceiptInvoice, subscriptionId: string) => {
    if (invoice.billing_reason !== 'subscription_cycle' || (invoice.amount_paid ?? 0) < 1000) return
    const apiKey = Deno.env.get('RESEND_API_KEY')
    const toEmail = invoice.customer_email
    if (!apiKey || !toEmail) return
    try {
      const sub = await stripe(`/subscriptions/${subscriptionId}`)
      const appUrl = Deno.env.get('APP_URL') || 'https://app.visibletrader.com'
      const paidAt = invoice.status_transitions?.paid_at ?? invoice.created
      await sendChargeReceiptEmail(
        apiKey,
        Deno.env.get('RESEND_FROM') || 'Visible Trader <billing@visibletrader.com>',
        {
          toEmail,
          amountCents: invoice.amount_paid ?? 0,
          currency: invoice.currency ?? 'usd',
          interval: sub.items?.data?.[0]?.price?.recurring?.interval ?? 'month',
          paidAtIso: new Date(paidAt * 1000).toISOString(),
          manageUrl: `${appUrl}/settings`,
          refundUrl: `${appUrl}/settings?refund=1`,
        },
        invoice.id,
      )
    } catch (err) {
      console.error('charge receipt email failed:', err)
    }
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed':
      case 'checkout.session.async_payment_succeeded': {
        const session = event.data.object
        if (session.subscription) await syncSubscription(session.subscription)
        break
      }
      // Refresh current state to tolerate retried or out-of-order deliveries.
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        await syncSubscription(event.data.object.id)
        break
      }
      // Covers a delayed initial $1 payment and renewal payment recovery.
      case 'invoice.paid':
      case 'invoice.payment_succeeded':
      case 'invoice.payment_failed': {
        const invoice = event.data.object
        const id = invoice.parent?.subscription_details?.subscription ?? invoice.subscription
        if (id) {
          if (event.type !== 'invoice.payment_failed') {
            await recordInvoicePayment(invoice, stripe, async (payment) => {
              const { error } = await supabase.from('subscription_payments')
                .upsert(payment, { onConflict: 'stripe_invoice_id', ignoreDuplicates: true })
              if (error) throw error
            })
          }
          await syncSubscription(id, true)
          if (event.type === 'invoice.paid') await sendReceipt(invoice, id)
        }
        break
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object
        const userId = sub.metadata?.supabase_user_id
        if (userId) {
          const { error } = await supabase.from('subscriptions')
            .update({ status: 'canceled', updated_at: new Date().toISOString() })
            .eq('user_id', userId)
            .eq('stripe_subscription_id', sub.id)
          if (error) throw error
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
