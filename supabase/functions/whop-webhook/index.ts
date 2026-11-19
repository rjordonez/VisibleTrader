// Receives Whop events and keeps `subscriptions` (the single source of truth
// for access) in sync for customers who paid through Whop. Every event that
// touches a membership re-reads the membership from Whop, so out-of-order or
// duplicate deliveries can't leave a stale status behind.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { membershipRow, verifyWhopSignature, whopConfig, whopFetch } from '../_shared/whop.ts'
import { whopWelcomeEmail } from './email.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// deno-lint-ignore no-explicit-any
function membershipIdFrom(type: string, data: any): string | null {
  if (!data) return null
  if (type.startsWith('membership.')) return data.id ?? null
  if (type.startsWith('payment.')) return data.membership_id ?? data.membership?.id ?? null
  const payment = data.payment
  if (payment && typeof payment === 'object') return payment.membership_id ?? payment.membership?.id ?? null
  return null
}

function centsFrom(value: unknown): number {
  if (value && typeof value === 'object' && 'amount' in (value as Record<string, unknown>)) {
    return Math.round(Number((value as { amount: string }).amount) * 100)
  }
  return Math.round(Number(value) * 100)
}

Deno.serve(async (req) => {
  const body = await req.text()
  const secret = Deno.env.get('WHOP_WEBHOOK_SECRET')
  const ok = secret && await verifyWhopSignature(secret, {
    id: req.headers.get('webhook-id'),
    timestamp: req.headers.get('webhook-timestamp'),
    signature: req.headers.get('webhook-signature'),
  }, body)
  if (!ok) return json({ error: 'invalid signature' }, 400)

  const whop = whopConfig((name) => Deno.env.get(name))
  if (!whop) return json({ error: 'whop not configured' }, 500)
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const webhookId = req.headers.get('webhook-id')!
  const event = JSON.parse(body)
  const type: string = event.type ?? ''

  try {
    const { data: seen } = await supabase.from('whop_webhook_events').select('webhook_id').eq('webhook_id', webhookId).maybeSingle()
    if (seen) return json({ received: true, duplicate: true })

    const membershipId = membershipIdFrom(type, event.data)
    if (membershipId) {
      const m = await whopFetch(whop, `/memberships/${membershipId}`)
      let userId: string | undefined = m.metadata?.supabase_user_id
      if (!userId) {
        const { data: byMembership } = await supabase.from('subscriptions')
          .select('user_id').eq('whop_membership_id', m.id).maybeSingle()
        userId = byMembership?.user_id
      }
      if (!userId) {
        console.error('whop membership without a Supabase user', m.id)
      } else {
        const { data: current, error: currentError } = await supabase.from('subscriptions')
          .select('provider, status, whop_membership_id').eq('user_id', userId).maybeSingle()
        if (currentError) throw currentError
        const liveStripe = current?.provider === 'stripe' && ['trialing', 'active', 'past_due'].includes(current.status ?? '')
        if (liveStripe) {
          console.error('not overwriting live Stripe subscription with Whop membership', userId, m.id)
        } else {
          const row = membershipRow(m)
          const { error } = await supabase.from('subscriptions').upsert({ user_id: userId, ...row }, { onConflict: 'user_id' })
          if (error) throw error

          const isNewMembership = current?.whop_membership_id !== m.id
          if (isNewMembership && row.status === 'trialing') await sendWelcome(supabase, userId, m)
        }

        if (type === 'payment.succeeded') await recordPayment(supabase, userId, event.data, whop.baseUrl)
      }
    }

    const { error: markError } = await supabase.from('whop_webhook_events')
      .insert({ webhook_id: webhookId, event_type: type })
    if (markError && markError.code !== '23505') throw markError
  } catch (err) {
    // Non-2xx makes Whop retry (12 times over ~3 days). Keep this rare: Whop
    // disables a webhook after 72 hours of failures.
    console.error('whop-webhook error:', type, err)
    return json({ error: (err as Error).message }, 500)
  }
  return json({ received: true })
})

// deno-lint-ignore no-explicit-any
async function sendWelcome(supabase: any, userId: string, m: any) {
  const apiKey = Deno.env.get('RESEND_API_KEY')
  if (!apiKey) return
  try {
    const { data } = await supabase.auth.admin.getUserById(userId)
    const to = data?.user?.email
    if (!to) return
    const appUrl = Deno.env.get('APP_URL') || 'https://app.visibletrader.com'
    const amountCents = centsFrom(m.renewal_price ?? 160) || 16000
    const chargeDateIso = m.current_period_end ?? new Date(Date.now() + 7 * 86_400_000).toISOString()
    const { subject, html } = whopWelcomeEmail({ amountCents, chargeDateIso, settingsUrl: `${appUrl}/settings` })
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': `whop-welcome-${m.id}` },
      body: JSON.stringify({ from: Deno.env.get('RESEND_FROM') || 'Visible Trader <billing@visibletrader.com>', to, subject, html }),
    })
    if (!res.ok) console.error('whop welcome email failed', res.status, await res.text())
  } catch (err) {
    console.error('whop welcome email failed', err)
  }
}

// Whop payments go into the same table as Stripe invoices so creator payout
// views keep counting them (see the whop_provider migration for column use).
// deno-lint-ignore no-explicit-any
async function recordPayment(supabase: any, userId: string, p: any, baseUrl: string) {
  if (!p?.id || !p.membership_id) return
  const cents = centsFrom(p.total ?? p.subtotal ?? 0)
  if (!(cents > 0)) return
  const { error } = await supabase.from('subscription_payments').upsert({
    stripe_invoice_id: p.id,
    user_id: userId,
    stripe_customer_id: p.member_id ?? p.member?.id ?? p.user?.id ?? 'whop',
    stripe_subscription_id: p.membership_id,
    amount_paid: cents,
    currency: (p.currency ?? 'usd').toLowerCase(),
    paid_at: p.paid_at ?? new Date().toISOString(),
    billing_reason: p.billing_reason ?? null,
    payment_kind: cents <= 500 ? 'introductory' : 'renewal',
    livemode: !baseUrl.includes('sandbox'),
    trial_ended_at: null,
    trial_classification_checked: true,
    provider: 'whop',
  }, { onConflict: 'stripe_invoice_id', ignoreDuplicates: true })
  if (error) throw error
}
