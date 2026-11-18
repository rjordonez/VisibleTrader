import { MONTHLY_INTRO_OFFER } from './subscription.ts'

export type PaidInvoice = {
  id: string
  customer: string | { id: string }
  subscription?: string | { id: string } | null
  parent?: { subscription_details?: { subscription?: string | { id: string } | null } }
  status: string
  paid_out_of_band?: boolean
  amount_paid: number
  currency: string
  livemode: boolean
  billing_reason?: string | null
  status_transitions?: { paid_at?: number | null }
}
export type Payment = {
  stripe_invoice_id: string
  user_id: string
  stripe_customer_id: string
  stripe_subscription_id: string
  amount_paid: number
  currency: string
  paid_at: string
  billing_reason: string | null
  payment_kind: 'introductory' | 'initial' | 'renewal' | 'adjustment'
  livemode: boolean
}
function objectId(value: string | { id: string } | null | undefined) {
  return typeof value === 'string' ? value : value?.id
}

// Shared with reconciliation. Zero-dollar trials and manually marked-paid
// invoices aren't successful charges. Retry DB failures, and deduplicate by
// invoice ID so invoice.paid, payment_succeeded, and backfill cannot double count.
export async function recordInvoicePayment(
  invoice: PaidInvoice,
  stripe: (path: string) => Promise<{ metadata?: Record<string, string> }>,
  save: (payment: Payment) => Promise<void>,
) {
  const subscriptionId = objectId(invoice.parent?.subscription_details?.subscription ?? invoice.subscription)
  if (!subscriptionId || invoice.status !== 'paid' || invoice.amount_paid <= 0 || invoice.paid_out_of_band) return
  const sub = await stripe(`/subscriptions/${subscriptionId}`)
  const userId = sub.metadata?.supabase_user_id
  if (!userId) throw new Error(`Missing account attribution for paid subscription ${subscriptionId}`)
  const initial = invoice.billing_reason === 'subscription_create'
  const customerId = objectId(invoice.customer)
  const paidAt = invoice.status_transitions?.paid_at
  if (!customerId || !paidAt || !Number.isSafeInteger(invoice.amount_paid)) throw new Error('Incomplete paid invoice')
  await save({
    stripe_invoice_id: invoice.id,
    user_id: userId,
    stripe_customer_id: customerId,
    stripe_subscription_id: subscriptionId,
    amount_paid: invoice.amount_paid,
    currency: invoice.currency,
    paid_at: new Date(paidAt * 1000).toISOString(),
    billing_reason: invoice.billing_reason ?? null,
    payment_kind: initial && sub.metadata?.offer === MONTHLY_INTRO_OFFER ? 'introductory'
      : initial ? 'initial' : invoice.billing_reason === 'subscription_cycle' ? 'renewal' : 'adjustment',
    livemode: invoice.livemode,
  })
}
