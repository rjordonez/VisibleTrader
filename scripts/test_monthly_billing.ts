// Real Stripe test-mode checks. Never accepts a live key or touches real users.
// deno run --allow-read=.env.local --allow-net=api.stripe.com --allow-write=/private/tmp/venter-monthly-test.json scripts/test_monthly_billing.ts
import { strict as assert } from 'node:assert'
import { checkoutLineItems, MONTHLY_INTRO_OFFER } from '../supabase/functions/create-checkout-session/checkout.ts'
import { subscriptionForAccess } from '../supabase/functions/stripe-webhook/subscription.ts'

const env = await Deno.readTextFile('.env.local')
const key = env.match(/^STRIPE_SECRET_KEY=(.+)$/m)?.[1].trim().replace(/^['"]|['"]$/g, '')
if (!key?.startsWith('sk_test_') && !key?.startsWith('rk_test_')) throw new Error('A Stripe test key is required')
const runId = crypto.randomUUID()
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))
async function stripe(path: string, method = 'GET', body?: URLSearchParams) {
  const response = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body?.toString(),
  })
  const value = await response.json()
  if (!response.ok) throw new Error(`${method} ${path}: ${value.error?.message}`)
  return value
}
const now = Math.floor(Date.now() / 1000)
const clock = await stripe('/test_helpers/test_clocks', 'POST', new URLSearchParams({ frozen_time: String(now), name: `VisibleTrader monthly billing QA ${runId}` }))
let sessionId: string | undefined
try {
  const product = await stripe('/products', 'POST', new URLSearchParams({ name: 'VisibleTrader monthly billing QA', tax_code: 'txcd_10103000', 'metadata[qa_run]': runId }))
  const monthly = await stripe('/prices', 'POST', new URLSearchParams({ product: product.id, currency: 'usd', unit_amount: '16000', 'recurring[interval]': 'month' }))
  const intro = await stripe('/prices', 'POST', new URLSearchParams({ product: product.id, currency: 'usd', unit_amount: '100' }))
  const config = { monthlyPrice: monthly.id, introPrice: intro.id, legacyCheckoutEnabled: false }
  const checkout = checkoutLineItems({ offer: MONTHLY_INTRO_OFFER }, config)
  checkout.set('mode', 'subscription')
  checkout.set('success_url', 'http://localhost:5173/?checkout=success')
  checkout.set('cancel_url', 'http://localhost:5173/pricing')
  const session = await stripe('/checkout/sessions', 'POST', checkout)
  sessionId = session.id
  assert.equal(session.livemode, false)
  assert.equal(session.amount_total, 100)
  const lines = await stripe(`/checkout/sessions/${session.id}/line_items`)
  assert.equal(lines.data.length, 2)
  assert.equal(lines.data.find((x: { price: { id: string } }) => x.price.id === monthly.id).price.recurring.interval, 'month')
  await Deno.writeTextFile('/private/tmp/venter-monthly-test.json', JSON.stringify({ checkoutUrl: session.url, sessionId, monthlyPrice: monthly.id, introPrice: intro.id, clock: clock.id }))
  console.log('PASS: actual Checkout Session is $1 upfront with a $160/month recurring price and seven-day trial')

  async function customer(name: string) {
    return await stripe('/customers', 'POST', new URLSearchParams({ name: `QA ${name} ${runId}`, test_clock: clock.id, payment_method: 'pm_card_visa', 'invoice_settings[default_payment_method]': 'pm_card_visa' }))
  }
  async function subscribe(customerId: string) {
    return await stripe('/subscriptions', 'POST', new URLSearchParams({ customer: customerId, 'items[0][price]': monthly.id, 'add_invoice_items[0][price]': intro.id, trial_period_days: '7', 'metadata[offer]': MONTHLY_INTRO_OFFER, 'expand[0]': 'latest_invoice' }))
  }
  const renewingCustomer = await customer('renewal')
  const renewing = await subscribe(renewingCustomer.id)
  assert.equal(renewing.status, 'trialing')
  assert.equal(renewing.trial_end - renewing.trial_start, 7 * 86400)
  assert.equal(renewing.latest_invoice.amount_paid, 100)
  assert.equal((await subscriptionForAccess(renewing.id, stripe)).status, 'trialing')
  console.log('PASS: $1 invoice paid and introductory access granted for exactly seven days')

  const cancelingCustomer = await customer('cancellation')
  const canceling = await subscribe(cancelingCustomer.id)
  await stripe(`/subscriptions/${canceling.id}`, 'POST', new URLSearchParams({ cancel_at_period_end: 'true' }))
  assert.equal((await subscriptionForAccess(canceling.id, stripe)).status, 'canceled')
  console.log('PASS: introductory cancellation immediately ends Stripe subscription and access')

  const failingCustomer = await customer('renewal decline')
  const failing = await subscribe(failingCustomer.id)
  const declined = await stripe('/payment_methods/pm_card_chargeCustomerFail/attach', 'POST', new URLSearchParams({ customer: failingCustomer.id }))
  await stripe(`/customers/${failingCustomer.id}`, 'POST', new URLSearchParams({ 'invoice_settings[default_payment_method]': declined.id }))
  async function advance(time: number) {
    await stripe(`/test_helpers/test_clocks/${clock.id}/advance`, 'POST', new URLSearchParams({ frozen_time: String(time) }))
    for (let n = 0; n < 60; n++) {
      await wait(1000)
      if ((await stripe(`/test_helpers/test_clocks/${clock.id}`)).status === 'ready') return
    }
    throw new Error('Test clock did not settle')
  }
  await advance(now + 7 * 86400 + 120)
  await advance(now + 7 * 86400 + 2 * 3600)
  const renewed = await stripe(`/subscriptions/${renewing.id}?expand[]=latest_invoice`)
  assert.equal(renewed.status, 'active')
  assert.equal(renewed.latest_invoice.amount_paid, 16000)
  assert.equal(renewed.items.data[0].price.recurring.interval, 'month')
  assert.equal((await subscriptionForAccess(renewed.id, stripe)).status, 'active')
  console.log('PASS: day-seven renewal collects $160 and starts a monthly paid period')
  const failed = await stripe(`/subscriptions/${failing.id}?expand[]=latest_invoice`)
  assert.equal(failed.status, 'past_due')
  assert.equal(failed.latest_invoice.amount_remaining, 16000)
  assert.equal((await subscriptionForAccess(failed.id, stripe)).status, 'past_due')
  console.log('PASS: declined $160 renewal moves to past_due and does not retain paid access')
  const canceledInvoices = await stripe(`/invoices?customer=${cancelingCustomer.id}`)
  assert.equal(canceledInvoices.data.length, 1)
  assert.equal(canceledInvoices.data[0].amount_paid, 100)
  console.log('PASS: canceled introduction has no $160 renewal invoice')
  for (const price of [monthly.id, intro.id]) await stripe(`/prices/${price}`, 'POST', new URLSearchParams({ active: 'false' }))
  await stripe(`/products/${product.id}`, 'POST', new URLSearchParams({ active: 'false' }))
} finally {
  if (sessionId) await stripe(`/checkout/sessions/${sessionId}/expire`, 'POST')
  await stripe(`/test_helpers/test_clocks/${clock.id}`, 'DELETE')
  console.log('Test clock/customers removed; test checkout expired. No live charges were made.')
}
