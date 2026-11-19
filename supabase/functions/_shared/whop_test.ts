import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseProvider, mapWhopStatus, membershipRow, membershipStatus, splitPercent, verifyWhopSignature, whopBucket } from './whop.ts'

test('split is stable per user and roughly matches the percentage', () => {
  const ids = Array.from({ length: 2000 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`)
  assert.equal(whopBucket(ids[0]), whopBucket(ids[0]))
  const whop = ids.filter((id) => chooseProvider(id, 25) === 'whop').length
  assert.ok(whop > 400 && whop < 600, `expected ~500 of 2000 on Whop at 25%, got ${whop}`)
  assert.equal(ids.filter((id) => chooseProvider(id, 0) === 'whop').length, 0)
  assert.equal(ids.filter((id) => chooseProvider(id, 100) === 'whop').length, ids.length)
})

test('split percent is clamped and defaults to 0', () => {
  assert.equal(splitPercent(undefined), 0)
  assert.equal(splitPercent('abc'), 0)
  assert.equal(splitPercent('25'), 25)
  assert.equal(splitPercent('250'), 100)
  assert.equal(splitPercent('-5'), 0)
})

test('Whop statuses map to the access statuses the app already uses', () => {
  assert.equal(mapWhopStatus('trialing'), 'trialing')
  assert.equal(mapWhopStatus('active'), 'active')
  assert.equal(mapWhopStatus('completed'), 'active')
  assert.equal(mapWhopStatus('past_due'), 'past_due')
  assert.equal(mapWhopStatus('unresolved'), 'past_due')
  assert.equal(mapWhopStatus('canceled'), 'canceled')
  assert.equal(mapWhopStatus('expired'), 'canceled')
  assert.equal(mapWhopStatus('weird'), 'incomplete')
})

test('membership row carries provider, ids and cancel flag', () => {
  const row = membershipRow({ id: 'mem_1', member_id: 'mber_1', user_id: 'user_1', variant_id: 'plan_1', status: 'trialing',
    cancel_at_period_end: true, current_period_end: '2026-11-26T00:00:00Z', manage_url: 'https://whop.com/billing/manage/mber_1' })
  assert.equal(row.provider, 'whop')
  assert.equal(row.status, 'trialing')
  assert.equal(row.cancel_at_period_end, true)
  assert.equal(row.whop_manage_url, 'https://whop.com/billing/manage/mber_1')
})

async function sign(key: Uint8Array, msg: string) {
  const k = await crypto.subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)))
  return btoa(String.fromCharCode(...sig))
}

test('signature verifies with the secret used as-is and rejects tampering', async () => {
  const secret = 'ws_testsecret123'
  const body = '{"type":"membership.updated"}'
  const now = 1795000000
  const sig = await sign(new TextEncoder().encode(secret), `msg_1.${now}.${body}`)
  const h = { id: 'msg_1', timestamp: String(now), signature: `v1,${sig}` }
  assert.equal(await verifyWhopSignature(secret, h, body, now), true)
  assert.equal(await verifyWhopSignature(secret, h, body + ' ', now), false)
  assert.equal(await verifyWhopSignature('ws_other', h, body, now), false)
  assert.equal(await verifyWhopSignature(secret, h, body, now + 1000), false)
})

test('signature also verifies Standard Webhooks style (base64 key after prefix)', async () => {
  const raw = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  const secret = 'whsec_' + btoa(String.fromCharCode(...raw))
  const body = '{}'
  const now = 1795000000
  const sig = await sign(raw, `msg_2.${now}.${body}`)
  assert.equal(await verifyWhopSignature(secret, { id: 'msg_2', timestamp: String(now), signature: `v1,${sig}` }, body, now), true)
})

test('paid trial: active with a 7-day first period on a 30-day plan reads as trialing', () => {
  const trial = { status: 'active', billing_period_days: 30, current_period_start: '2026-11-19T05:55:26Z', current_period_end: '2026-11-26T05:55:26Z' }
  assert.equal(membershipStatus(trial), 'trialing')
  const renewed = { status: 'active', billing_period_days: 30, current_period_start: '2026-11-26T05:55:26Z', current_period_end: '2026-12-26T05:55:26Z' }
  assert.equal(membershipStatus(renewed), 'active')
  assert.equal(membershipStatus({ ...trial, status: 'past_due' }), 'past_due')
  assert.equal(membershipStatus({ ...trial, status: 'canceled' }), 'canceled')
  assert.equal(membershipRow(trial).status, 'trialing')
})
