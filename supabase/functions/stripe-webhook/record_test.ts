import { strict as assert } from 'node:assert'
import { accessRank, shouldReplaceRecord } from './record.ts'

const sub = (id: string, status: string, created: number) => ({ id, status, created })

Deno.test('no row yet, or the same subscription, always writes', () => {
  assert.equal(shouldReplaceRecord(null, sub('a', 'canceled', 1)), true)
  assert.equal(shouldReplaceRecord(sub('a', 'trialing', 1), sub('a', 'canceled', 1)), true)
  assert.equal(shouldReplaceRecord(sub('a', 'past_due', 1), sub('a', 'active', 1)), true)
})

Deno.test('Nov 18 bug: a late cancel of the old trial cannot overwrite the new trial', () => {
  const newTrial = sub('new', 'trialing', 200)
  const oldTrialCanceled = sub('old', 'canceled', 100)
  assert.equal(shouldReplaceRecord(newTrial, oldTrialCanceled), false)
})

Deno.test('a new trial replaces a row that points at an old canceled subscription', () => {
  assert.equal(shouldReplaceRecord(sub('old', 'canceled', 100), sub('new', 'trialing', 200)), true)
})

Deno.test('two live subscriptions: the row follows the one that grants access', () => {
  const paid = sub('paid', 'active', 100)
  const duplicate = sub('dup', 'past_due', 200)
  assert.equal(shouldReplaceRecord(paid, duplicate), false)
  assert.equal(shouldReplaceRecord(duplicate, paid), true)
})

Deno.test('equal standing: the newer subscription wins', () => {
  assert.equal(shouldReplaceRecord(sub('old', 'canceled', 100), sub('new', 'canceled', 200)), true)
  assert.equal(shouldReplaceRecord(sub('new', 'canceled', 200), sub('old', 'canceled', 100)), false)
  assert.equal(shouldReplaceRecord(sub('old', 'trialing', 100), sub('new', 'trialing', 200)), true)
})

Deno.test('past due still outranks canceled and incomplete', () => {
  assert.equal(shouldReplaceRecord(sub('pd', 'past_due', 100), sub('x', 'canceled', 200)), false)
  assert.equal(shouldReplaceRecord(sub('pd', 'past_due', 100), sub('x', 'incomplete', 200)), false)
  assert.ok(accessRank('unpaid') > accessRank('incomplete'))
  assert.equal(accessRank(undefined), 0)
})
