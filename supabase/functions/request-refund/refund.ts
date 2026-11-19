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

// Reasons offered on the refund page. Keys are stored; labels go in emails.
export const REFUND_CATEGORIES: Record<string, string> = {
  forgot_to_cancel: "I meant to cancel before I was charged",
  not_expected: "The product wasn't what I expected",
  technical: 'Something did not work',
  unexpected_charge: "I didn't expect this charge",
  other: 'Other',
}
export const MIN_DETAILS_LENGTH = 20

export function cleanCategory(raw: unknown): string | null {
  return typeof raw === 'string' && raw in REFUND_CATEGORIES ? raw : null
}

// Short human-readable reference, e.g. RR-7K2Q9M. Random, not derived from
// the user id, so it can be shown to the customer.
export function newReference(random: () => number = Math.random): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = 'RR-'
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(random() * alphabet.length)]
  return out
}

export type RefundRequest = {
  reference?: string
  category?: string
  customerEmail: string
  userId: string
  stripeCustomerId: string
  subscriptionStatus: string
  charge: RefundCharge
  reason: string
  // Whop customers: stripeCustomerId holds the Whop membership id and
  // charge.invoiceId the Whop payment id.
  provider?: 'stripe' | 'whop'
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

  const subject = `Refund request${req.reference ? ` ${req.reference}` : ''}: ${req.customerEmail} (${amount} on ${date})`
  const html = `<!doctype html>
<html>
  <body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a2330;font-size:14px;line-height:1.5;">
    <h2 style="margin:0 0 12px;">Refund request</h2>
    <p style="margin:0 0 12px;">Reply to this email to answer the customer directly. They were told to expect a reply within 24 to 72 hours.</p>
    <table style="border-collapse:collapse;">
      ${req.reference ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7684;">Reference</td><td><strong>${escapeHtml(req.reference)}</strong></td></tr>` : ''}
      <tr><td style="padding:4px 12px 4px 0;color:#6b7684;">Customer</td><td>${escapeHtml(req.customerEmail)}</td></tr>
      ${req.category ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7684;">Reason</td><td>${escapeHtml(REFUND_CATEGORIES[req.category] ?? req.category)}</td></tr>` : ''}
      <tr><td style="padding:4px 12px 4px 0;color:#6b7684;">Charge</td><td>${amount} on ${date}</td></tr>
      <tr><td style="padding:4px 12px 4px 0;color:#6b7684;">Subscription</td><td>${escapeHtml(req.subscriptionStatus)}</td></tr>
      ${req.provider === 'whop'
        ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7684;">Whop</td><td>Payment ${escapeHtml(req.charge.invoiceId)} · Membership ${escapeHtml(req.stripeCustomerId)} (refund in the <a href="https://whop.com/dashboard">Whop dashboard</a>)</td></tr>`
        : `<tr><td style="padding:4px 12px 4px 0;color:#6b7684;">Stripe</td><td><a href="${customerUrl}">Customer</a> · <a href="${invoiceUrl}">Invoice</a></td></tr>`}
      <tr><td style="padding:4px 12px 4px 0;color:#6b7684;">User ID</td><td>${escapeHtml(req.userId)}</td></tr>
    </table>
    <h3 style="margin:16px 0 4px;">Customer's explanation</h3>
    <p style="margin:0;">${reason}</p>
    <p style="margin:16px 0 0;color:#6b7684;font-size:12px;">Refund the full amount and cancel together. Partial refunds can still be disputed and don't qualify for automatic dispute resolution.</p>
  </body>
</html>`
  return { subject, html }
}

// Confirmation the customer receives right after submitting.
export function refundConfirmationEmail(p: { reference: string; amountCents: number; currency: string; paidAt: number; settingsUrl: string }): { subject: string; html: string } {
  const amount = formatAmount(p.amountCents, p.currency)
  const date = formatDate(p.paidAt)
  const subject = `We received your refund request (${p.reference})`
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a2330;">
    <div style="max-width:480px;margin:0 auto;padding:32px 20px;">
      <div style="font-size:18px;font-weight:700;color:#0074d4;margin-bottom:24px;">Visible Trader</div>
      <div style="background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e3e8ee;">
        <h1 style="margin:0 0 12px;font-size:20px;">Refund request received</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
          We've received your request to refund <strong>${amount}</strong> charged on <strong>${date}</strong>.
          Our team reviews every request and will email you within <strong>24 to 72 hours</strong>.
        </p>
        <table style="border-collapse:collapse;font-size:14px;margin:0 0 20px;">
          <tr><td style="padding:4px 16px 4px 0;color:#6b7684;">Reference</td><td><strong>${escapeHtml(p.reference)}</strong></td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7684;">Amount</td><td>${amount}</td></tr>
          <tr><td style="padding:4px 16px 4px 0;color:#6b7684;">Charge date</td><td>${date}</td></tr>
        </table>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#3b4652;">
          If your refund is approved, it goes back to your original payment method and usually appears within 5 to 10 business days.
          Reply to this email if you have anything to add.
        </p>
        <a href="${p.settingsUrl}" style="display:inline-block;background:#ffffff;color:#1a2330;border:1px solid #c9d1da;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;">
          View your account
        </a>
      </div>
      <p style="margin:20px 0 0;font-size:12px;color:#9aa4b1;text-align:center;">
        Visible Trader · You're receiving this because you requested a refund.
      </p>
    </div>
  </body>
</html>`
  return { subject, html }
}
