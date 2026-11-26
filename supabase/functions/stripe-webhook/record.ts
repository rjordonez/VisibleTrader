// Each user has one `subscriptions` row, but can have several Stripe
// subscriptions (a re-subscribe after a cancel, or a duplicate). Events for
// any of them reach syncSubscription, so this decides which one the row
// should follow. Without it, a late "canceled" event for an old subscription
// overwrote a live new one (Nov 18, 2026), locking a paying customer out and
// letting checkout sell them a second subscription.

type SubLike = { id: string; status: string; created?: number }

// Higher means "more alive". Trialing and active both grant access; past_due
// and unpaid are still billing; incomplete never got its first payment.
export function accessRank(status: string | undefined): number {
  switch (status) {
    case 'trialing':
    case 'active':
      return 3
    case 'past_due':
    case 'unpaid':
      return 2
    case 'incomplete':
      return 1
    default:
      return 0
  }
}

// `current` is the subscription the row points at now (null when there is no
// row, or Stripe can no longer find it). `incoming` is the one an event is
// about. The same subscription always updates its own row.
export function shouldReplaceRecord(current: SubLike | null, incoming: SubLike): boolean {
  if (!current || current.id === incoming.id) return true
  const cur = accessRank(current.status)
  const inc = accessRank(incoming.status)
  if (inc !== cur) return inc > cur
  return (incoming.created ?? 0) >= (current.created ?? 0)
}
