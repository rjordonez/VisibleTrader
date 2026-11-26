import { strict as assert } from 'node:assert'
import { duplicatesEmail, findDuplicates, ignoreList, type LiveSub } from './duplicates.ts'

const s = (id: string, user: string | undefined, status: string, created: number): LiveSub => ({
  id, status, created, customer: 'cus_' + id,
  metadata: user ? { supabase_user_id: user } : {},
  items: { data: [{ price: { unit_amount: 16000, recurring: { interval: 'month' } } }] },
})

Deno.test('flags only users with two or more live subscriptions', () => {
  const dups = findDuplicates([
    s('a1', 'u1', 'active', 2), s('a2', 'u1', 'past_due', 1),
    s('b1', 'u2', 'trialing', 1),
    s('c1', 'u3', 'trialing', 1), s('c2', 'u3', 'canceled', 2),
  ])
  assert.deepEqual(dups.map((d) => d.userId), ['u1'])
  assert.deepEqual(dups[0].subs.map((x) => x.id), ['a2', 'a1'])
})

Deno.test('the same subscription listed twice is not a duplicate; no user id is ignored', () => {
  assert.equal(findDuplicates([s('a', 'u1', 'active', 1), s('a', 'u1', 'active', 1)]).length, 0)
  assert.equal(findDuplicates([s('a', undefined, 'active', 1), s('b', undefined, 'active', 1)]).length, 0)
})

Deno.test('email lists each customer and escapes what it shows', () => {
  const { subject, html } = duplicatesEmail(findDuplicates([s('x1', 'u1', 'active', 1), s('x2', 'u1', 'trialing', 2)]), { u1: '<b>a@b.co</b>' })
  assert.equal(subject, '1 customer has more than one live subscription')
  assert.match(html, /&lt;b&gt;a@b\.co&lt;\/b&gt;/)
  assert.match(html, /dashboard\.stripe\.com\/subscriptions\/x1/)
  assert.match(html, /\$160\/month/)
})

Deno.test('users on the ignore list are left out of the alert', () => {
  const subs = [s('a1', 'u1', 'active', 1), s('a2', 'u1', 'active', 2), s('b1', 'u2', 'active', 1), s('b2', 'u2', 'trialing', 2)]
  assert.deepEqual(findDuplicates(subs, ignoreList(' u1 ,')).map((d) => d.userId), ['u2'])
  assert.deepEqual(findDuplicates(subs, ignoreList(undefined)).map((d) => d.userId), ['u1', 'u2'])
})
