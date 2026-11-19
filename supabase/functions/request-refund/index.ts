// Customer-facing "Request a refund". Emails the support inbox with the
// customer's latest full-price charge and their reason; nothing is refunded
// automatically. Only open after the trial (a full-price charge must exist),
// and limited to one email per customer per day via Resend's idempotency key.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  cleanReason,
  DEFAULT_REFUND_INBOX,
  latestRefundableCharge,
  refundRequestEmail,
} from './refund.ts'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'content-type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json({ error: 'not authenticated' }, 401)

    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: userErr } = await supabaseAuth.auth.getUser()
    if (userErr || !user?.email) return json({ error: 'not authenticated' }, 401)

    const body = await req.json().catch(() => ({}))
    const reason = cleanReason((body as { reason?: unknown }).reason)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: sub, error: subErr } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id, status')
      .eq('user_id', user.id)
      .maybeSingle()
    if (subErr) throw subErr
    if (!sub?.stripe_customer_id) return json({ error: 'no subscription on file' }, 404)
    if (sub.status === 'trialing') {
      return json({ error: 'Refund requests open after your first full charge. You can cancel your introductory period instead.' }, 400)
    }

    const invoicesRes = await fetch(
      `https://api.stripe.com/v1/invoices?customer=${encodeURIComponent(sub.stripe_customer_id)}&status=paid&limit=10`,
      { headers: { Authorization: `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}` } },
    )
    const invoices = await invoicesRes.json()
    if (!invoicesRes.ok) throw new Error(invoices.error?.message || 'Could not look up charges')
    const charge = latestRefundableCharge(invoices.data ?? [])
    if (!charge) return json({ error: 'We could not find a full-price charge to refund.' }, 400)

    const apiKey = Deno.env.get('RESEND_API_KEY')
    if (!apiKey) throw new Error('email is not configured')
    const { subject, html } = refundRequestEmail({
      customerEmail: user.email,
      userId: user.id,
      stripeCustomerId: sub.stripe_customer_id,
      subscriptionStatus: sub.status ?? 'unknown',
      charge,
      reason,
    })
    const day = new Date().toISOString().slice(0, 10)
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `refund-request-${user.id}-${day}`,
      },
      body: JSON.stringify({
        from: Deno.env.get('RESEND_FROM') || 'Visible Trader <billing@visibletrader.com>',
        to: Deno.env.get('REFUND_REQUEST_TO') || DEFAULT_REFUND_INBOX,
        reply_to: user.email,
        subject,
        html,
      }),
    })
    if (!res.ok) throw new Error(`Resend send failed (${res.status}): ${await res.text()}`)

    return json({ requested: true })
  } catch (err) {
    console.error('request-refund error:', err)
    return json({ error: 'Could not send your request. Please try again in a moment.' }, 500)
  }
})
