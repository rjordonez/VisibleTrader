import assert from 'node:assert/strict'
import { sanitizeAnalyticsProperties, sanitizeAnalyticsUrl } from '../src/lib/analyticsPrivacy.ts'

const callback = 'https://app.visibletrader.com/?code=private-code&utm_source=creator#access_token=private-access&refresh_token=private-refresh'
assert.equal(sanitizeAnalyticsUrl(callback), 'https://app.visibletrader.com/?utm_source=creator')
assert.equal(sanitizeAnalyticsUrl('https://app.visibletrader.com/?ACCESS_TOKEN=private&refresh_token=private'), 'https://app.visibletrader.com/')
const original = { $current_url: callback, $set_once: { $initial_current_url: callback }, nested: [callback], amount: 42, label: 'settings_saved' }
const sanitized = sanitizeAnalyticsProperties(original)
assert.equal(JSON.stringify(sanitized).includes('private'), false)
assert.equal(original.$current_url, callback)
assert.equal(sanitized.amount, 42)
assert.equal(sanitized.label, 'settings_saved')
assert.equal(sanitizeAnalyticsUrl('https://visibletrader.com/pricing?offer=pro_monthly_intro_v1'), 'https://visibletrader.com/pricing?offer=pro_monthly_intro_v1')
console.log('PASS: analytics callback URLs redact credentials and preserve attribution')
