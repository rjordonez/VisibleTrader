// Finds users with more than one live Stripe subscription, the state that
// leads to double charges. Live means it can still bill or already grants
// access.

export const LIVE_STATUSES = ['trialing', 'active', 'past_due', 'unpaid'] as const

export type LiveSub = {
  id: string
  status: string
  customer: string
  created: number
  metadata?: Record<string, string>
  items?: { data?: { price?: { unit_amount?: number | null; recurring?: { interval?: string } | null } }[] }
}

export type Duplicate = { userId: string; subs: LiveSub[] }

export function findDuplicates(subs: LiveSub[]): Duplicate[] {
  const byUser = new Map<string, Map<string, LiveSub>>()
  for (const s of subs) {
    const userId = s.metadata?.supabase_user_id
    if (!userId || !(LIVE_STATUSES as readonly string[]).includes(s.status)) continue
    if (!byUser.has(userId)) byUser.set(userId, new Map())
    byUser.get(userId)!.set(s.id, s)
  }
  return [...byUser.entries()]
    .filter(([, m]) => m.size > 1)
    .map(([userId, m]) => ({ userId, subs: [...m.values()].sort((a, b) => a.created - b.created) }))
    .sort((a, b) => a.userId.localeCompare(b.userId))
}

function price(s: LiveSub): string {
  const p = s.items?.data?.[0]?.price
  if (!p?.unit_amount) return ''
  return `$${(p.unit_amount / 100).toFixed(0)}/${p.recurring?.interval ?? '?'}`
}

const esc = (v: string) => v.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))

export function duplicatesEmail(dups: Duplicate[], emails: Record<string, string>): { subject: string; html: string } {
  const rows = dups.map((d) => {
    const list = d.subs.map((s) =>
      `<li><a href="https://dashboard.stripe.com/subscriptions/${esc(s.id)}">${esc(s.id)}</a> · ${esc(s.status)} · ${esc(price(s))} · started ${new Date(s.created * 1000).toISOString().slice(0, 10)}</li>`
    ).join('')
    return `<p><strong>${esc(emails[d.userId] ?? d.userId)}</strong> (${esc(d.userId)})</p><ul>${list}</ul>`
  }).join('')
  const n = dups.length
  return {
    subject: `${n} customer${n === 1 ? ' has' : 's have'} more than one live subscription`,
    html: `<p>Each customer below can be charged more than once. Cancel the extra subscription in Stripe (and refund any duplicate charge) before it bills.</p>${rows}`,
  }
}
