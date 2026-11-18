// Start Vite using the dummy backend environment from docs/referral-payment-tracking.md.
// npm install --prefix /tmp/vt-referral-qa playwright@1.65.1
// QA_PACKAGE_DIR=/tmp/vt-referral-qa CHROMIUM_PATH=/path/to/chromium node scripts/referral-tracking-browser.test.mjs
import { createRequire } from 'node:module'
import { strict as assert } from 'node:assert'
const require = createRequire(`${process.env.QA_PACKAGE_DIR || process.cwd()}/package.json`)
const { chromium } = require('playwright')
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) })
const base = 'http://127.0.0.1:5198'
const user = { id: '00000000-0000-0000-0000-000000000003', email: 'qa@example.invalid', aud: 'authenticated', role: 'authenticated', created_at: new Date().toISOString(), app_metadata: { provider: 'google' }, user_metadata: {}, identities: [] }
try {
  const context = await browser.newContext()
  let failCapture = true
  const captures = []
  await context.route('**/*', async route => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1') {
      if (url.pathname.startsWith('/analytics/')) return route.fulfill({ json: {} })
      return route.continue()
    }
    if (url.hostname !== 'referral-qa.supabase.co') return route.abort()
    if (url.pathname.endsWith('/rpc/capture_signup_referral')) {
      captures.push(route.request().postDataJSON())
      return route.fulfill({ status: failCapture ? 500 : 204, ...(failCapture ? { json: { message: 'temporary database failure' } } : { body: '' }) })
    }
    if (url.pathname === '/auth/v1/user') return route.fulfill({ json: user })
    return route.fulfill({ json: url.pathname.endsWith('/rpc/public_trade_count') ? 0 : [] })
  })
  const page = await context.newPage()
  await page.goto(`${base}/r/anthony`)
  await page.waitForURL(`${base}/`)
  assert.equal((await context.cookies()).find(c => c.name === 'vt_referral_code')?.value, 'anthony')
  await page.goto(`${base}/r/jc`)
  await page.waitForURL(`${base}/`)
  assert.equal((await context.cookies()).find(c => c.name === 'vt_referral_code')?.value, 'anthony')
  const exp = Math.floor(Date.now() / 1000) + 3600
  const jwt = `${Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp, role: 'authenticated' })).toString('base64url')}.qa`
  await page.evaluate(({ user, jwt, exp }) => localStorage.setItem('sb-referral-qa-auth-token', JSON.stringify({ access_token: jwt, refresh_token: 'qa-refresh', expires_at: exp, expires_in: 3600, token_type: 'bearer', user })), { user, jwt, exp })
  await page.goto(`${base}/app/`)
  await page.getByRole('button', { name: 'Try again', exact: true }).waitFor()
  assert.equal(await page.locator('.onboarding-root').count(), 0)
  failCapture = false
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await page.locator('.onboarding-root').waitFor()
  assert.ok(captures.length >= 2)
  assert.ok(captures.every(x => x.p_code === 'anthony'))
  await context.close()
  console.log('PASS: first-touch cookie retained; signup attribution runs before onboarding; failed capture blocks and retry succeeds')
} finally { await browser.close() }
