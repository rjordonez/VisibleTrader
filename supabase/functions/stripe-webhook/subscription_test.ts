import { strict as assert } from 'node:assert'
import { subscriptionForAccess, MONTHLY_INTRO_OFFER, type StripeRequest } from './subscription.ts'

const base = { id: 'sub_test', customer: 'cus_test', status: 'trialing', metadata: { offer: MONTHLY_INTRO_OFFER } }
Deno.test('unpaid or failed introductory invoice does not grant trial access', async () => {
  for (const status of ['open', 'void', 'uncollectible', undefined]) {
    const sub = await subscriptionForAccess(base.id, async () => ({ ...base, latest_invoice: { status } }))
    assert.equal(sub.status, 'incomplete')
  }
})
Deno.test('paid $1 introduction grants trial access; successful renewal grants active access', async () => {
  assert.equal((await subscriptionForAccess(base.id, async () => ({ ...base, latest_invoice: { status: 'paid' } }))).status, 'trialing')
  assert.equal((await subscriptionForAccess(base.id, async () => ({ ...base, status: 'active' }))).status, 'active')
})
Deno.test('current canceled or failed-renewal state wins over a delayed trial event', async () => {
  for (const status of ['canceled', 'past_due', 'unpaid']) {
    assert.equal((await subscriptionForAccess(base.id, async () => ({ ...base, status }))).status, status)
  }
})
Deno.test('portal cancellation during the introduction immediately ends access', async () => {
  const calls: string[] = []
  const stripe: StripeRequest = async (path, method = 'GET') => {
    calls.push(`${method} ${path}`)
    return { ...base, status: method === 'DELETE' ? 'canceled' : 'trialing', canceled_at: 1, cancel_at: 2 }
  }
  assert.equal((await subscriptionForAccess(base.id, stripe)).status, 'canceled')
  assert.equal(calls[1], 'DELETE /subscriptions/sub_test')
})
Deno.test('existing weekly subscribers and paid monthly cancellations retain their billing policy', async () => {
  let deletes = 0
  for (const fixture of [
    { ...base, status: 'active', canceled_at: 1, cancel_at: 2 },
    { ...base, metadata: {}, canceled_at: 1, cancel_at: 2 },
  ]) {
    const result = await subscriptionForAccess(base.id, async (_path, method) => { if (method === 'DELETE') deletes++; return fixture })
    assert.equal(result.status, fixture.status)
  }
  assert.equal(deletes, 0)
})
