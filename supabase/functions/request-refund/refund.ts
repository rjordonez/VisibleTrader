// Refund requests go to the support inbox as an email instead of refunding
// automatically, so a person decides. The customer never sees the inbox
// address; replying to the email goes straight to them via reply_to.

export const DEFAULT_REFUND_INBOX = 'hq@visibletrader.com'
export const MAX_REASON_LENGTH = 2000
export const MIN_REFUNDABLE_CENTS = 1000 // ignore the $1 intro charge

export type RefundCharge = {
  invoiceId: string
  amountCents: number
  currency: string
  paidAt: number // unix seconds
  livemode: boolean
}

export type RefundRequest = {
  customerEmail: string
  userId: string
  stripeCustomerId: string
  subscriptionStatus: string
  charge: RefundCharge
  reason: string
}

type PaidInvoiceLike = {
  id: string
  amount_paid: number
  currency: string
  created: number
  livemode: boolean
  status_transitions?: { paid_at?: number | null }
}

// Most recent full-price charge, newest first as Stripe lists invoices.
export function latestRefundableCharge(invoices: PaidInvoiceLike[]): RefundCharge | null {
  const inv = invoices.find((i) => i.amount_paid >= MIN_REFUNDABLE_CENTS)
  if (!inv) return null
  return {
    invoiceId: inv.id,
    amountCents: inv.amount_paid,
    currency: inv.currency,
    paidAt: inv.status_transitions?.paid_at ?? inv.created,
    livemode: inv.livemode,
  }
}

export function cleanReason(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  return raw.trim().slice(0, MAX_REASON_LENGTH)
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)
}

function formatDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

export function refundRequestEmail(req: RefundRequest): { subject: string; html: string } {
  const amount = formatAmount(req.charge.amountCents, req.charge.currency)
  const date = formatDate(req.charge.paidAt)
  const dashboard = `https://dashboard.stripe.com${req.charge.livemode ? '' : '/test'}`
  const customerUrl = `${dashboard}/customers/${encodeURIComponent(req.stripeCustomerId)}`
  const invoiceUrl = `${dashboard}/invoices/${encodeURIComponent(req.charge.invoiceId)}`
  const reason = req.reason ? escapeHtml(req.reason).replace(/\n/g, '<br>') : '<em>No reason given</em>'

  const subject = `Refund request: ${req.customerEmail} (${amount} on ${date})`
  const html = `<!doctype html>
<html>
  <body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a2330;font-size:14px;line-height:1.5;">
    <h2 style="margin:0 0 12px;">Refund request</h2>
    <p style="margin:0 0 12px;">Reply to this email to answer the customer directly. They were told to expect a reply within 24 to 72 hours.</p>
    <table style="border-collapse:collapse;">
      <tr><td style="padding:4px 12px 4px 0;color:#6b7684;">Customer</td><td>${escapeHtml(req.customerEmail)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b7684;">Charge</td><td>${amount} on ${date}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b7684;">Subscription</td><td>${escapeHtml(req.subscriptionStatus)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b7684;">Stripe</td><td><a href="${customerUrl}">Customer</a> · <a href="${invoiceUrl}">Invoice</a></td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b7684;">User ID</td><td>${escapeHtml(req.userId)}</td></tr>
    </table>
    <h3 style="margin:16px 0 4px;">Reason</h3>
    <p style="margin:0;">${reason}</p>
    <p style="margin:16px 0 0;color:#6b7684;font-size:12px;">Refund the full amount and cancel together. Partial refunds can still be disputed and don't qualify for automatic dispute resolution.</p>
  </body>
</html>`
  return { subject, html }
}
