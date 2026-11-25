// Automatic response to Stripe early fraud warnings (the card network's
// "this cardholder reported fraud" signal, which usually turns into a fraud
// dispute days later). Refunding at the warning stops that dispute, avoids
// the dispute fee, and keeps it off the dispute rate. Dispute prevention
// (RDR / Ethoca) only acts on disputes, not on warnings, so this fills the gap.

export type FraudWarning = { id: string; charge: string; actionable?: boolean; fraud_type?: string }
export type ChargeLike = {
  id: string
  amount: number
  amount_refunded?: number
  currency: string
  refunded?: boolean
  disputed?: boolean
  customer?: string | null
  billing_details?: { email?: string | null }
  receipt_email?: string | null
  payment_method_details?: { card?: { fingerprint?: string | null; brand?: string | null; last4?: string | null } }
}

// Refund only when Stripe still marks the warning actionable and the charge
// isn't already refunded or disputed (a disputed charge can't be refunded).
export function refundDecision(efw: FraudWarning, charge: ChargeLike): { refund: boolean; why: string } {
  if (efw.actionable === false) return { refund: false, why: 'warning not actionable' }
  if (charge.disputed) return { refund: false, why: 'already disputed' }
  if (charge.refunded || (charge.amount_refunded ?? 0) >= charge.amount) return { refund: false, why: 'already refunded' }
  return { refund: true, why: 'refund to prevent dispute' }
}

const LIVE_STATUSES = new Set(['trialing', 'active', 'past_due', 'unpaid', 'incomplete'])
export function subscriptionsToCancel(subs: { id: string; status: string }[]): string[] {
  return subs.filter((s) => LIVE_STATUSES.has(s.status)).map((s) => s.id)
}

export function fraudNoticeEmail(p: {
  warningId: string; fraudType: string; chargeId: string; amountCents: number; currency: string
  email: string | null; refunded: boolean; why: string; canceled: string[]; blocked: string[]
}): { subject: string; html: string } {
  const amount = new Intl.NumberFormat('en-US', { style: 'currency', currency: p.currency.toUpperCase() }).format(p.amountCents / 100)
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const subject = `${p.refunded ? 'Auto-refunded' : 'Fraud warning (not refunded)'}: ${amount} ${p.email ? `from ${p.email}` : ''}`.trim()
  const html = `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a2330;font-size:14px;line-height:1.5;">
    <h2 style="margin:0 0 12px;">Early fraud warning handled</h2>
    <table style="border-collapse:collapse;">
      <tr><td style="padding:3px 12px 3px 0;color:#6b7684;">Customer</td><td>${esc(p.email ?? 'unknown')}</td></tr>
      <tr><td style="padding:3px 12px 3px 0;color:#6b7684;">Charge</td><td>${esc(p.chargeId)} (${amount})</td></tr>
      <tr><td style="padding:3px 12px 3px 0;color:#6b7684;">Warning</td><td>${esc(p.warningId)} (${esc(p.fraudType)})</td></tr>
      <tr><td style="padding:3px 12px 3px 0;color:#6b7684;">Refund</td><td>${p.refunded ? 'Refunded in full' : `Not refunded: ${esc(p.why)}`}</td></tr>
      <tr><td style="padding:3px 12px 3px 0;color:#6b7684;">Subscriptions canceled</td><td>${p.canceled.length ? esc(p.canceled.join(', ')) : 'none'}</td></tr>
      <tr><td style="padding:3px 12px 3px 0;color:#6b7684;">Blocked</td><td>${p.blocked.length ? esc(p.blocked.join(', ')) : 'nothing'}</td></tr>
    </table>
  </body></html>`
  return { subject, html }
}
