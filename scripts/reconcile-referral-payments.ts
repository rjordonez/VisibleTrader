// Dry run by default. Requires STRIPE_SECRET_KEY; --apply additionally requires
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. Never run with browser credentials.
import { recordInvoicePayment, type PaidInvoice } from '../supabase/functions/stripe-webhook/payments.ts'
const apply = Deno.args.includes('--apply')
const stripeKey = Deno.env.get('STRIPE_SECRET_KEY')
if (!stripeKey) throw new Error('STRIPE_SECRET_KEY is required')
const supabaseUrl = Deno.env.get('SUPABASE_URL')
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
if (apply && (!supabaseUrl || !serviceKey)) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required for --apply')
async function stripe(path: string) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, { headers: { Authorization: `Bearer ${stripeKey}` } })
  if (!response.ok) throw new Error(`Stripe read failed (${response.status})`)
  return await response.json()
}
type SubscriptionSnapshot = { id: string; metadata?: Record<string,string>; trial_end?: number | null; trial_start?: number | null; livemode?: boolean }
const subscriptions = new Map<string, SubscriptionSnapshot>()
// Load subscriptions in pages rather than one request per invoice. Also
// reconcile free trials, which have no positive invoice to enter the loop below.
let subscriptionCursor = ''
let trialSnapshots = 0
for (;;) {
  const params = new URLSearchParams({ limit:'100', status:'all', ...(subscriptionCursor ? { starting_after:subscriptionCursor } : {}) })
  const page = await stripe(`/subscriptions?${params}`) as { data: SubscriptionSnapshot[]; has_more:boolean }
  for (const sub of page.data) {
    subscriptions.set(`/subscriptions/${sub.id}`,sub)
    if (apply && sub.trial_end) {
      const response = await fetch(`${supabaseUrl}/rest/v1/subscriptions?stripe_subscription_id=eq.${encodeURIComponent(sub.id)}`, {
        method:'PATCH', headers:{apikey:serviceKey!,Authorization:`Bearer ${serviceKey}`,'Content-Type':'application/json'},
        body:JSON.stringify({stripe_livemode:sub.livemode??null,stripe_trial_started_at:sub.trial_start?new Date(sub.trial_start*1000).toISOString():null,stripe_trial_ends_at:new Date(sub.trial_end*1000).toISOString()}),
      })
      if(!response.ok) throw new Error(`Trial snapshot write failed (${response.status})`)
      trialSnapshots++
    }
  }
  if(!page.has_more)break
  const next=page.data.at(-1)?.id
  if(!next||next===subscriptionCursor)throw new Error('Subscription pagination did not advance')
  subscriptionCursor=next
}
let cursor = ''
let eligible = 0
let skipped = 0
let failed = 0
for (;;) {
  const params = new URLSearchParams({ limit: '100', status: 'paid', ...(cursor ? { starting_after: cursor } : {}) })
  const page = await stripe(`/invoices?${params}`) as { data: PaidInvoice[]; has_more: boolean }
  for (const invoice of page.data) {
    if (!invoice.livemode) { skipped++; continue }
    let recorded = false
    try {
      await recordInvoicePayment(invoice, async path => {
        if (!subscriptions.has(path)) subscriptions.set(path, await stripe(path))
        return subscriptions.get(path)!
      }, async payment => {
        if (apply) {
          const response = await fetch(`${supabaseUrl}/rest/v1/subscription_payments?on_conflict=stripe_invoice_id`, {
            method: 'POST',
            headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
            body: JSON.stringify(payment),
          })
          if (!response.ok) throw new Error(`Payment write failed (${response.status}); check account still exists and migration is installed`)
          // Existing ledger amounts and attribution stay immutable. Reconcile
          // only the new trial classification on historical invoice records.
          const classification = await fetch(`${supabaseUrl}/rest/v1/subscription_payments?stripe_invoice_id=eq.${encodeURIComponent(payment.stripe_invoice_id)}`, {
            method: 'PATCH', headers: { apikey: serviceKey!, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ trial_ended_at: payment.trial_ended_at, trial_classification_checked: true }),
          })
          if (!classification.ok) throw new Error(`Trial classification write failed (${classification.status})`)

        }
        recorded = true
      })
      if (recorded) eligible++; else skipped++
    } catch (error) {
      failed++
      console.error(`Invoice ${invoice.id}: ${error instanceof Error ? error.message : 'Reconciliation failed'}`)
    }
  }
  if (!page.has_more) break
  const next = page.data.at(-1)?.id
  if (!next || next === cursor) throw new Error('Stripe pagination did not advance')
  cursor = next
}
console.log(JSON.stringify({ mode: apply ? 'apply (existing invoices ignored)' : 'dry-run', trial_snapshots_updated: trialSnapshots, eligible_invoices: eligible, skipped_invoices: skipped, failed_invoices: failed }))
if (failed) Deno.exitCode = 1
