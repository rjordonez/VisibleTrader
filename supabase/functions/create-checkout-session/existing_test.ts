import { strict as assert } from 'node:assert'
import { checkoutDecision, stripeSubscriptionsFor } from './existing.ts'

const openBill = { status: 'open', hosted_invoice_url: 'https://invoice.stripe.com/i/test' }

Deno.test('no subscriptions, or only ended ones: checkout is allowed', () => {
  assert.deepEqual(checkoutDecision([]), { kind: 'ok' })
  assert.deepEqual(checkoutDecision([
    { id: 'a', status: 'canceled' },
    { id: 'b', status: 'incomplete_expired' },
    { id: 'c', status: 'incomplete' },
  ]), { kind: 'ok' })
})

Deno.test('trialing or active anywhere in Stripe blocks a second subscription', () => {
  assert.deepEqual(checkoutDecision([{ id: 'a', status: 'canceled' }, { id: 'b', status: 'trialing' }]), { kind: 'already_subscribed' })
  assert.deepEqual(checkoutDecision([{ id: 'a', status: 'active' }]), { kind: 'already_subscribed' })
  // Evan's case: one paid and active, one duplicate past due. Still blocked.
  assert.deepEqual(checkoutDecision([{ id: 'dup', status: 'past_due', latest_invoice: openBill }, { id: 'paid', status: 'active' }]), { kind: 'already_subscribed' })
})

Deno.test('past due: pay the open bill instead of starting a new $1 trial', () => {
  assert.deepEqual(
    checkoutDecision([{ id: 'old', status: 'past_due', latest_invoice: openBill }]),
    { kind: 'pay_invoice', url: 'https://invoice.stripe.com/i/test' },
  )
  assert.deepEqual(checkoutDecision([{ id: 'old', status: 'unpaid', latest_invoice: openBill }]), { kind: 'pay_invoice', url: openBill.hosted_invoice_url })
})

Deno.test('past due with no payable invoice still blocks, with no link', () => {
  assert.deepEqual(checkoutDecision([{ id: 'old', status: 'past_due', latest_invoice: { status: 'void' } }]), { kind: 'pay_invoice', url: null })
  assert.deepEqual(checkoutDecision([{ id: 'old', status: 'past_due', latest_invoice: 'in_unexpanded' }]), { kind: 'pay_invoice', url: null })
})

Deno.test('looks up by user id and by customer, merging duplicates', async () => {
  const calls: string[] = []
  const subs = await stripeSubscriptionsFor('402bee07-88a7-497b-87ce-b06bb82bad1f', 'cus_1', async (path) => {
    calls.push(path)
    return path.startsWith('/subscriptions/search')
      ? { data: [{ id: 'a', status: 'active' }, { id: 'b', status: 'canceled' }] }
      : { data: [{ id: 'b', status: 'canceled' }, { id: 'c', status: 'past_due' }] }
  })
  assert.deepEqual(subs.map((s) => s.id).sort(), ['a', 'b', 'c'])
  assert.equal(calls.length, 2)
  assert.match(calls[0], /supabase_user_id/)
  assert.match(calls[1], /customer=cus_1&status=all/)
})

Deno.test('a malformed user id is never put into a search query', async () => {
  const calls: string[] = []
  await stripeSubscriptionsFor("x' OR status:'active", null, async (path) => { calls.push(path); return { data: [] } })
  assert.equal(calls.length, 0)
})
