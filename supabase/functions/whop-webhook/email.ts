// Sign-up email for Whop customers. Whop's own trial reminder only goes out
// about 24 hours before the first full charge on short trials, so this one
// lands at sign-up with the amount, the charge date and how to cancel.

export type WhopWelcomeEmail = {
  amountCents: number
  chargeDateIso: string
  settingsUrl: string
}

function formatAmount(cents: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

export function whopWelcomeEmail(p: WhopWelcomeEmail): { subject: string; html: string } {
  const amount = formatAmount(p.amountCents)
  const date = formatDate(p.chargeDateIso)
  const subject = `Welcome to Visible Trader: your first week is $1, then ${amount}/month from ${date}`
  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1a2330;">
    <div style="max-width:480px;margin:0 auto;padding:32px 20px;">
      <div style="font-size:18px;font-weight:700;color:#0074d4;margin-bottom:24px;">Visible Trader</div>
      <div style="background:#ffffff;border-radius:12px;padding:28px;border:1px solid #e3e8ee;">
        <h1 style="margin:0 0 12px;font-size:20px;">You're in</h1>
        <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">
          You paid <strong>$1</strong> for your first week of <strong>Visible Trader</strong>.
          On <strong>${date}</strong> your card will be charged <strong>${amount}/month</strong> unless you cancel before then.
        </p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.5;">
          On your bank statement this appears as <strong>WHOP*VISIBLETRADER</strong>.
        </p>
        <a href="${p.settingsUrl}"
           style="display:inline-block;background:#ffffff;color:#1a2330;border:1px solid #c9d1da;text-decoration:none;font-weight:600;font-size:15px;padding:12px 20px;border-radius:8px;">
          Manage or cancel anytime
        </a>
        <p style="margin:24px 0 0;font-size:13px;color:#6b7684;line-height:1.5;">
          Questions? Just reply to this email.
        </p>
      </div>
      <p style="margin:20px 0 0;font-size:12px;color:#9aa4b1;text-align:center;">
        Visible Trader · You're receiving this because you started a subscription.
      </p>
    </div>
  </body>
</html>`
  return { subject, html }
}
