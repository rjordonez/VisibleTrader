export const MONTHLY_INTRO_OFFER = 'pro_monthly_intro_v1'

type StripeSubscription = {
  id: string
  customer: string
  status: string
  metadata?: Record<string, string>
  cancel_at?: number | null
  cancel_at_period_end?: boolean
  canceled_at?: number | null
  latest_invoice?: { status?: string; paid?: boolean } | null
  current_period_end?: number
  items?: { data?: { price?: { id?: string }; current_period_end?: number }[] }
}

export type StripeRequest = (path: string, method?: string) => Promise<StripeSubscription>

// Read current Stripe state rather than trusting delivery order. In particular,
// subscription.created may arrive before the $1 payment, and an older update
// may arrive after cancellation. Neither should grant unpaid/revoked access.
export async function subscriptionForAccess(id: string, stripe: StripeRequest) {
  let sub = await stripe(`/subscriptions/${id}?expand[]=latest_invoice`)
  if (sub.metadata?.offer === MONTHLY_INTRO_OFFER && sub.status === 'trialing') {
    // The portal schedules cancellation; the agreed introductory-period policy
    // is immediate loss of access regardless of which cancellation UI is used.
    if (sub.canceled_at && (sub.cancel_at || sub.cancel_at_period_end)) {
      sub = await stripe(`/subscriptions/${id}`, 'DELETE')
    } else if (sub.latest_invoice?.status !== 'paid') {
      return { ...sub, status: 'incomplete' }
    }
  }
  return sub
}
