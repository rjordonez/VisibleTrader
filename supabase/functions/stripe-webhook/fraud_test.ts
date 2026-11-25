import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fraudNoticeEmail, refundDecision, subscriptionsToCancel } from './fraud.ts'

const charge = { id: 'ch_1', amount: 17024, currency: 'usd', refunded: false, disputed: false }

test('refunds an actionable warning on a live charge', () => {
  assert.equal(refundDecision({ id: 'issfr_1', charge: 'ch_1', actionable: true }, charge).refund, true)
})

test('skips charges that are already disputed or refunded, or warnings Stripe marks not actionable', () => {
  assert.equal(refundDecision({ id: 'w', charge: 'ch_1' }, { ...charge, disputed: true }).refund, false)
  assert.equal(refundDecision({ id: 'w', charge: 'ch_1' }, { ...charge, refunded: true }).refund, false)
  assert.equal(refundDecision({ id: 'w', charge: 'ch_1' }, { ...charge, amount_refunded: 17024 }).refund, false)
  assert.equal(refundDecision({ id: 'w', charge: 'ch_1', actionable: false }, charge).refund, false)
})

test('cancels only subscriptions that could still bill', () => {
  assert.deepEqual(subscriptionsToCancel([
    { id: 'sub_a', status: 'active' }, { id: 'sub_t', status: 'trialing' }, { id: 'sub_p', status: 'past_due' },
    { id: 'sub_c', status: 'canceled' }, { id: 'sub_e', status: 'incomplete_expired' },
  ]), ['sub_a', 'sub_t', 'sub_p'])
})

test('support notice states outcome and escapes values', () => {
  const { subject, html } = fraudNoticeEmail({ warningId: 'issfr_1', fraudType: 'unauthorized_use_of_card', chargeId: 'ch_1',
    amountCents: 17024, currency: 'usd', email: 'a<b>@example.invalid', refunded: true, why: '', canceled: ['sub_a'], blocked: ['card'] })
  assert.match(subject, /^Auto-refunded: \$170\.24/)
  assert.ok(!html.includes('a<b>'))
  assert.match(html, /Refunded in full/)
})
