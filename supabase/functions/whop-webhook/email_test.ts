import assert from 'node:assert/strict'
import { test } from 'node:test'
import { whopWelcomeEmail } from './email.ts'

test('welcome email states $1 today, the $160 charge date, the statement name and a cancel link', () => {
  const { subject, html } = whopWelcomeEmail({ amountCents: 16000, chargeDateIso: '2026-11-26T05:00:00Z', settingsUrl: 'https://app.visibletrader.com/settings' })
  assert.match(subject, /\$1/)
  assert.match(subject, /\$160\.00\/month/)
  assert.match(subject, /November 26, 2026/)
  assert.match(html, /WHOP\*VISIBLETRADER/)
  assert.ok(html.includes('https://app.visibletrader.com/settings'))
})
