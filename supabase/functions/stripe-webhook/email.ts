// Sends the "your trial is ending" reminder via Resend. Kept as its own module
// so the template is unit-testable without hitting the network — same split as
// checkout.ts / subscription.ts.
//
// Why this exists: ~all disputes land on the first real charge right after the
// trial converts, and the reason codes are "unrecognized"/"I cancelled" — i.e.
// people forgot the trial and don't recognize the charge. A heads-up a few days
// before the charge (with a clear amount, date, and cancel link) is the single
// cheapest lever to cut those chargebacks.

const RESEND_ENDPOINT = 'https://api.resend.com/emails'

export type TrialEndingEmail = {
  toEmail: string
  amountCents: number
  currency: string
  interval: string // 'week' | 'month' | 'year'
  trialEndIso: string // when the trial ends / the first real charge lands
  cancelUrl: string
}

function formatAmount(cents: number, currency: string): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}

function formatDate(iso: string): string {
  // Pin to UTC so the rendered day is deterministic (not the runtime's local
  // zone) and matches the instant Stripe stores for trial_end.
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  })
}

function intervalWord(interval: string): string {
  return interval === 'week' ? 'week' : interval === 'year' ? 'year' : 'month'
}

// Pure template — no network, so it can be asserted on in tests.
export function trialEndingEmail(params: TrialEndingEmail): { subject: string; html: string } {
  const amount = formatAmount(params.amountCents, params.currency)
  const date = formatDate(params.trialEndIso)
  const per = intervalWord(params.interval)

  const subject = `Your Visible Trader trial ends ${date} — you'll be charged ${amount}`

  // Inline styles only: email clients strip <style> blocks and class selectors.
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a2330;">
    <div style="max-width:480px;margin:0 auto;padding:32px 20px;">
      <div style="font-size:18px;font-weight:700;color:#0074d4;margin-bottom:24px;">Visible Trader</div>
      <div style="background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e3e8ee;">
        <h1 style="margin:0 0 12px;font-size:20px;">Your trial is ending</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
          Heads up — your <strong>Visible Trader</strong> trial ends on <strong>${date}</strong>.
          On that day your card will be charged <strong>${amount}/${per}</strong> and your subscription continues.
        </p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
          Want to keep your access? You don't need to do anything.
        </p>
        <a href="${params.cancelUrl}"
           style="display:inline-block;background:#ffffff;color:#d12d2d;border:1px solid #d12d2d;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;">
          Cancel before you're charged
        </a>
        <p style="margin:24px 0 0;font-size:13px;color:#6b7684;line-height:1.5;">
          Charges appear as <strong>Visible Trader</strong> on your statement.
          Questions? Just reply to this email.
        </p>
      </div>
      <p style="margin:20px 0 0;font-size:12px;color:#9aa4b1;text-align:center;">
        Visible Trader · You're receiving this because you started a subscription trial.
      </p>
    </div>
  </body>
</html>`

  return { subject, html }
}

export type ChargeReceiptEmail = {
  toEmail: string
  amountCents: number
  currency: string
  interval: string
  paidAtIso: string
  manageUrl: string
  refundUrl: string
}

// Sent when a full-price charge lands (first charge after the trial and each
// renewal). A clear receipt plus an obvious refund path gives someone who
// regrets the charge a way to reach us before they reach their bank.
export function chargeReceiptEmail(params: ChargeReceiptEmail): { subject: string; html: string } {
  const amount = formatAmount(params.amountCents, params.currency)
  const date = formatDate(params.paidAtIso)
  const per = intervalWord(params.interval)

  const subject = `Your Visible Trader receipt: ${amount} charged ${date}`

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a2330;">
    <div style="max-width:480px;margin:0 auto;padding:32px 20px;">
      <div style="font-size:18px;font-weight:700;color:#0074d4;margin-bottom:24px;">Visible Trader</div>
      <div style="background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e3e8ee;">
        <h1 style="margin:0 0 12px;font-size:20px;">Payment received</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
          We charged <strong>${amount}</strong> on <strong>${date}</strong> for your
          <strong>Visible Trader</strong> subscription (${amount}/${per}). Thanks for being a member.
        </p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
          On your bank statement this appears as <strong>LINK.COM* VISIBLE TRAD</strong>.
        </p>
        <a href="${params.manageUrl}"
           style="display:inline-block;background:#0074d4;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;margin:0 8px 8px 0;">
          Manage subscription
        </a>
        <a href="${params.refundUrl}"
           style="display:inline-block;background:#ffffff;color:#1a2330;border:1px solid #c9d1da;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;margin:0 0 8px;">
          Request a refund
        </a>
        <p style="margin:16px 0 0;font-size:13px;color:#6b7684;line-height:1.5;">
          Didn't mean to keep your subscription? Request a refund and our team will get back to you within 24 to 72 hours.
        </p>
      </div>
      <p style="margin:20px 0 0;font-size:12px;color:#9aa4b1;text-align:center;">
        Visible Trader · You're receiving this because a payment was made on your subscription.
      </p>
    </div>
  </body>
</html>`

  return { subject, html }
}

// Shared Resend call. The idempotency key lets Stripe redeliver the same
// event (or send invoice.paid and invoice.payment_succeeded together)
// without the customer getting the email twice.
export async function sendEmail(
  apiKey: string,
  message: { from: string; to: string; subject: string; html: string; replyTo?: string },
  idempotencyKey?: string,
): Promise<void> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey
  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      from: message.from,
      to: message.to,
      subject: message.subject,
      html: message.html,
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    }),
  })
  if (!res.ok) {
    throw new Error(`Resend send failed (${res.status}): ${await res.text()}`)
  }
}

// Fires the actual send. Throws on a non-2xx so the caller can decide whether to
// swallow it (we do — a reminder is best-effort and must not fail the webhook).
export async function sendTrialEndingEmail(
  apiKey: string,
  from: string,
  params: TrialEndingEmail,
): Promise<void> {
  const { subject, html } = trialEndingEmail(params)
  await sendEmail(apiKey, { from, to: params.toEmail, subject, html })
}

export async function sendChargeReceiptEmail(
  apiKey: string,
  from: string,
  params: ChargeReceiptEmail,
  invoiceId: string,
): Promise<void> {
  const { subject, html } = chargeReceiptEmail(params)
  await sendEmail(apiKey, { from, to: params.toEmail, subject, html }, `charge-receipt-${invoiceId}`)
}
