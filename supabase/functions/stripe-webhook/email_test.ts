import assert from 'node:assert/strict'
import { test } from 'node:test'
import { trialEndingEmail } from './email.ts'

const base = {
  toEmail: 'trader@example.invalid',
  amountCents: 16000,
  currency: 'usd',
  interval: 'month',
  trialEndIso: '2026-11-24T00:00:00.000Z',
  cancelUrl: 'https://app.visibletrader.com/settings',
}

test('subject names the amount and date for recognition', () => {
  const { subject } = trialEndingEmail(base)
  assert.match(subject, /\$160\.00/)
  assert.match(subject, /November 24, 2026/)
})

test('body shows amount, interval, date, and a working cancel link', () => {
  const { html } = trialEndingEmail(base)
  assert.match(html, /\$160\.00\/month/)
  assert.match(html, /November 24, 2026/)
  assert.ok(html.includes('https://app.visibletrader.com/settings'))
  assert.match(html, /Cancel before you're charged/)
})

test('weekly plans say /week', () => {
  const { html } = trialEndingEmail({ ...base, interval: 'week', amountCents: 4000 })
  assert.match(html, /\$40\.00\/week/)
})
