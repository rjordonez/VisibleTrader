// Customer-facing "Request a refund". Emails the support inbox with the
// customer's latest full-price charge and their reason; nothing is refunded
// automatically. Only open after the trial (a full-price charge must exist),
// and limited to one email per customer per day via Resend's idempotency key.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  cleanCategory,
  cleanReason,
  DEFAULT_REFUND_INBOX,
  latestRefundableCharge,
  MIN_DETAILS_LENGTH,
  newReference,
  refundConfirmationEmail,
  refundRequestEmail,
} from './refund.ts'
import { whopConfig, whopFetch } from '../_shared/whop.ts'

// Shape a Whop payment like the Stripe invoice fields latestRefundableCharge reads.
// deno-lint-ignore no-explicit-any
const whopPaymentAsInvoice = (baseUrl: string) => (p: any) => {
  const total = typeof p.total === 'object' && p.total ? Number(p.total.amount) : Number(p.total ?? p.usd_total ?? 0)
  const paidAt = p.paid_at ? Math.floor(new Date(p.paid_at).getTime() / 1000) : Math.floor(new Date(p.created_at).getTime() / 1000)
  return {
    id: p.id,
    amount_paid: Math.round(total * 100),
    currency: (p.currency ?? 'usd').toLowerCase(),
    created: paidAt,
    livemode: !baseUrl.includes('sandbox'),
    status_transitions: { paid_at: paidAt },
  }
}

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

    const body = await req.json().catch(() => ({})) as {
      mode?: string; category?: unknown; details?: unknown; confirm?: unknown; reason?: unknown
    }
    const preview = body.mode === 'preview'
    // The older inline Settings form only sent { reason }; treat that as
    // category "other" so it keeps working until every client has updated.
    const legacy = body.category === undefined && typeof body.reason === 'string'
    const category = legacy ? 'other' : cleanCategory(body.category)
    const details = cleanReason(legacy ? body.reason : body.details)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const { data: sub, error: subErr } = await supabase
      .from('subscriptions')
      .select('stripe_customer_id, status, provider, whop_membership_id')
      .eq('user_id', user.id)
      .maybeSingle()
    if (subErr) throw subErr
    const isWhop = sub?.provider === 'whop' && !!sub.whop_membership_id
    if (!sub || (!isWhop && !sub.stripe_customer_id)) {
      return preview ? json({ eligible: false, why: 'no_subscription' }) : json({ error: 'no subscription on file' }, 404)
    }
    if (sub.status === 'trialing') {
      return preview
        ? json({ eligible: false, why: 'trial' })
        : json({ error: 'Refund requests open after your first full charge. You can cancel your introductory period instead.' }, 400)
    }

    let charge
    if (isWhop) {
      const whop = whopConfig((name) => Deno.env.get(name))
      if (!whop) throw new Error('whop not configured')
      const payments = await whopFetch(whop,
        `/payments?account_id=${whop.accountId}&membership_id=${sub.whop_membership_id}&statuses=paid&first=10`)
      charge = latestRefundableCharge((payments.data ?? []).map(whopPaymentAsInvoice(whop.baseUrl)))
    } else {
      const invoicesRes = await fetch(
        `https://api.stripe.com/v1/invoices?customer=${encodeURIComponent(sub.stripe_customer_id!)}&status=paid&limit=10`,
        { headers: { Authorization: `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}` } },
      )
      const invoices = await invoicesRes.json()
      if (!invoicesRes.ok) throw new Error(invoices.error?.message || 'Could not look up charges')
      charge = latestRefundableCharge(invoices.data ?? [])
    }
    if (!charge) {
      return preview ? json({ eligible: false, why: 'no_charge' }) : json({ error: 'We could not find a full-price charge to refund.' }, 400)
    }

    // An open request from the last 24 hours is reused, so a double submit
    // or a second visit doesn't send duplicate emails.
    const since = new Date(Date.now() - 86_400_000).toISOString()
    const { data: recent, error: recentErr } = await supabase.from('refund_requests')
      .select('reference, created_at').eq('user_id', user.id).gte('created_at', since)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (recentErr) throw recentErr

    if (preview) {
      return json({
        eligible: true,
        email: user.email,
        provider: isWhop ? 'whop' : 'stripe',
        amount_cents: charge.amountCents,
        currency: charge.currency,
        paid_at: charge.paidAt,
        existing_reference: recent?.reference ?? null,
      })
    }
    if (recent) return json({ requested: true, reference: recent.reference, duplicate: true })

    if (!category) return json({ error: 'Please choose a reason.' }, 400)
    if (!legacy && details.length < MIN_DETAILS_LENGTH) {
      return json({ error: `Please describe what happened (at least ${MIN_DETAILS_LENGTH} characters).` }, 400)
    }
    if (!legacy && body.confirm !== true) return json({ error: 'Please confirm the details are accurate.' }, 400)

    let reference = ''
    for (let attempt = 0; attempt < 3 && !reference; attempt++) {
      const candidate = newReference()
      const { error: insertErr } = await supabase.from('refund_requests').insert({
        reference: candidate,
        user_id: user.id,
        provider: isWhop ? 'whop' : 'stripe',
        charge_ref: charge.invoiceId,
        amount_cents: charge.amountCents,
        currency: charge.currency,
        category,
        details,
      })
      if (!insertErr) reference = candidate
      else if (insertErr.code !== '23505') throw insertErr
    }
    if (!reference) throw new Error('could not allocate a reference')

    const apiKey = Deno.env.get('RESEND_API_KEY')
    if (!apiKey) throw new Error('email is not configured')
    const { subject, html } = refundRequestEmail({
      reference,
      category,
      customerEmail: user.email,
      userId: user.id,
      stripeCustomerId: isWhop ? sub.whop_membership_id! : sub.stripe_customer_id!,
      subscriptionStatus: sub.status ?? 'unknown',
      provider: isWhop ? 'whop' : 'stripe',
      charge,
      reason: details,
    })
    const from = Deno.env.get('RESEND_FROM') || 'Visible Trader <billing@visibletrader.com>'
    const send = (idempotencyKey: string, payload: Record<string, unknown>) => fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
      body: JSON.stringify({ from, ...payload }),
    })
    const res = await send(`refund-request-${reference}`, {
      to: Deno.env.get('REFUND_REQUEST_TO') || DEFAULT_REFUND_INBOX,
      reply_to: user.email,
      subject,
      html,
    })
    if (!res.ok) throw new Error(`Resend send failed (${res.status}): ${await res.text()}`)

    // Customer confirmation is best-effort: the request is already recorded.
    const appUrl = Deno.env.get('APP_URL') || 'https://app.visibletrader.com'
    const confirmation = refundConfirmationEmail({
      reference, amountCents: charge.amountCents, currency: charge.currency, paidAt: charge.paidAt, settingsUrl: `${appUrl}/settings`,
    })
    const confirmRes = await send(`refund-confirm-${reference}`, { to: user.email, ...confirmation })
    if (!confirmRes.ok) console.error('refund confirmation email failed', confirmRes.status, await confirmRes.text())

    return json({ requested: true, reference })
  } catch (err) {
    console.error('request-refund error:', err)
    return json({ error: 'Could not send your request. Please try again in a moment.' }, 500)
  }
})
