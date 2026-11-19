import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cleanCategory, cleanReason, latestRefundableCharge, MAX_REASON_LENGTH, newReference, refundConfirmationEmail, refundRequestEmail } from './refund.ts'

const invoice = (id: string, amount: number) => ({
  id, amount_paid: amount, currency: 'usd', created: 1795000000, livemode: true,
  status_transitions: { paid_at: 1795046400 },
})

test('skips the $1 intro and picks the newest full-price charge', () => {
  const charge = latestRefundableCharge([invoice('in_intro', 100), invoice('in_full', 16000), invoice('in_old', 16000)])
  assert.equal(charge?.invoiceId, 'in_full')
  assert.equal(charge?.amountCents, 16000)
})

test('no full-price charge means nothing to refund', () => {
  assert.equal(latestRefundableCharge([invoice('in_intro', 100)]), null)
  assert.equal(latestRefundableCharge([]), null)
})

test('reason is trimmed, capped, and non-strings become empty', () => {
  assert.equal(cleanReason('  forgot to cancel  '), 'forgot to cancel')
  assert.equal(cleanReason('x'.repeat(5000)).length, MAX_REASON_LENGTH)
  assert.equal(cleanReason(42), '')
})

test('email names the customer and charge, links Stripe, and escapes the reason', () => {
  const { subject, html } = refundRequestEmail({
    customerEmail: 'trader@example.invalid',
    userId: 'user-1',
    stripeCustomerId: 'cus_123',
    subscriptionStatus: 'active',
    charge: { invoiceId: 'in_full', amountCents: 16000, currency: 'usd', paidAt: 1795046400, livemode: true },
    reason: '<script>alert(1)</script>',
  })
  assert.match(subject, /trader@example\.invalid/)
  assert.match(subject, /\$160\.00/)
  assert.ok(html.includes('https://dashboard.stripe.com/customers/cus_123'))
  assert.ok(html.includes('https://dashboard.stripe.com/invoices/in_full'))
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;script&gt;'))
})

test('test-mode charges link to the test dashboard', () => {
  const { html } = refundRequestEmail({
    customerEmail: 'a@example.invalid', userId: 'u', stripeCustomerId: 'cus_t', subscriptionStatus: 'past_due',
    charge: { invoiceId: 'in_t', amountCents: 16000, currency: 'usd', paidAt: 1795046400, livemode: false },
    reason: '',
  })
  assert.ok(html.includes('https://dashboard.stripe.com/test/customers/cus_t'))
  assert.ok(html.includes('No reason given'))
})

test('references look like RR- plus 6 unambiguous characters', () => {
  const ref = newReference()
  assert.match(ref, /^RR-[A-HJ-NP-Z2-9]{6}$/)
})

test('only known refund reasons are accepted', () => {
  assert.equal(cleanCategory('forgot_to_cancel'), 'forgot_to_cancel')
  assert.equal(cleanCategory('hack'), null)
  assert.equal(cleanCategory(undefined), null)
})

test('support email carries the reference and readable reason', () => {
  const { subject, html } = refundRequestEmail({
    reference: 'RR-ABC234', category: 'unexpected_charge',
    customerEmail: 'a@example.invalid', userId: 'u', stripeCustomerId: 'cus_1', subscriptionStatus: 'active',
    charge: { invoiceId: 'in_1', amountCents: 16000, currency: 'usd', paidAt: 1795046400, livemode: true }, reason: 'did not expect it',
  })
  assert.match(subject, /^Refund request RR-ABC234: /)
  assert.match(html, /I didn&#39;t expect this charge/)
})

test('customer confirmation states reference, amount and the 24 to 72 hour window', () => {
  const { subject, html } = refundConfirmationEmail({ reference: 'RR-ABC234', amountCents: 16000, currency: 'usd', paidAt: 1795046400, settingsUrl: 'https://app.visibletrader.com/settings' })
  assert.match(subject, /RR-ABC234/)
  assert.match(html, /\$160\.00/)
  assert.match(html, /24 to 72 hours/)
})
