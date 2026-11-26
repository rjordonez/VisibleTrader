// Decides whether a user may start a new Stripe checkout, based on the Stripe
// subscriptions they already have. Our `subscriptions` row alone is not
// enough: it can point at the wrong subscription (see stripe-webhook/record.ts),
// and a past-due customer used to be able to buy a fresh $1 trial while the
// old subscription kept retrying their card, ending in two charges.

type Invoice = { status?: string; hosted_invoice_url?: string | null }

export type ExistingSub = {
  id: string
  status: string
  latest_invoice?: Invoice | string | null
}

export type CheckoutDecision =
  | { kind: 'ok' }
  | { kind: 'already_subscribed' }
  // Pay the open bill on the existing subscription instead of starting a new
  // one. url is null when Stripe has no payable invoice to link to.
  | { kind: 'pay_invoice'; url: string | null }

const HAS_ACCESS = ['trialing', 'active']
const STILL_BILLING = ['past_due', 'unpaid']

export function checkoutDecision(subs: ExistingSub[]): CheckoutDecision {
  if (subs.some((s) => HAS_ACCESS.includes(s.status))) return { kind: 'already_subscribed' }
  const owing = subs.find((s) => STILL_BILLING.includes(s.status))
  if (owing) {
    const invoice = typeof owing.latest_invoice === 'object' ? owing.latest_invoice : null
    const url = invoice?.status === 'open' ? invoice.hosted_invoice_url ?? null : null
    return { kind: 'pay_invoice', url }
  }
  // Canceled, ended or never-paid (incomplete) subscriptions don't block a
  // new checkout, same as before.
  return { kind: 'ok' }
}

type StripeGet = (path: string) => Promise<{ data?: ExistingSub[] }>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Every Stripe subscription for this user: by the user id our checkout stamps
// on each subscription (covers every Stripe customer they were given), plus
// by the customer on record, since Stripe's search index can lag new
// subscriptions by up to a minute.
export async function stripeSubscriptionsFor(
  userId: string,
  customerId: string | null | undefined,
  get: StripeGet,
): Promise<ExistingSub[]> {
  const found = new Map<string, ExistingSub>()
  if (UUID.test(userId)) {
    const query = encodeURIComponent(`metadata['supabase_user_id']:'${userId}'`)
    const res = await get(`/subscriptions/search?query=${query}&limit=50&expand[]=data.latest_invoice`)
    for (const s of res.data ?? []) found.set(s.id, s)
  }
  if (customerId) {
    const res = await get(`/subscriptions?customer=${encodeURIComponent(customerId)}&status=all&limit=50&expand[]=data.latest_invoice`)
    for (const s of res.data ?? []) found.set(s.id, s)
  }
  return [...found.values()]
}
