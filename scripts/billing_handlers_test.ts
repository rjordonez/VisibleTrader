import { strict as assert } from 'node:assert'

type Handler = (req: Request) => Promise<Response>
const handlers: Handler[] = []
const originalServe = Deno.serve
Deno.serve = ((handler: Handler) => { handlers.push(handler); return {} }) as unknown as typeof Deno.serve
for (const [name, value] of Object.entries({
  SUPABASE_URL: 'https://billing-qa.supabase.co', SUPABASE_ANON_KEY: 'qa-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'qa-service', STRIPE_SECRET_KEY: 'qa-stripe',
  STRIPE_PRICE_PRO_MONTHLY: 'price_monthly', STRIPE_PRICE_PRO_INTRO_WEEK: 'price_intro',
  STRIPE_WEBHOOK_SECRET: 'qa-webhook-secret', APP_URL: 'https://app.visibletrader.com',
})) Deno.env.set(name, value)
await import('../supabase/functions/create-checkout-session/index.ts')
await import('../supabase/functions/stripe-webhook/index.ts')
await import('../supabase/functions/cancel-trial/index.ts')
Deno.serve = originalServe
const [checkout, webhook, cancel] = handlers
const originalFetch = globalThis.fetch
let existing: Record<string, unknown> | null = null
let currentStatus = 'trialing'
let invoiceStatus = 'paid'
let dbFailure = false
const writes: Record<string, unknown>[] = []
const stripeCalls: { path: string; method: string; body: string }[] = []
const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(String(input))
  const method = init?.method || 'GET'
  if (url.hostname === 'billing-qa.supabase.co') {
    if (url.pathname === '/auth/v1/user') return reply({ id: 'qa-user', email: 'qa@example.invalid' })
    if (url.pathname === '/rest/v1/subscriptions') {
      if (dbFailure) return reply({ message: 'database unavailable', code: 'QA_FAILURE' }, 500)
      if (method === 'GET') return reply(existing ? [existing] : [])
      writes.push(JSON.parse(String(init?.body)))
      return new Response(null, { status: 204 })
    }
  }
  if (url.hostname === 'api.stripe.com') {
    stripeCalls.push({ path: url.pathname, method, body: String(init?.body || '') })
    if (url.pathname === '/v1/checkout/sessions') return reply({ url: 'https://checkout.stripe.com/qa-session' })
    if (url.pathname === '/v1/subscriptions/sub_qa') return reply({ id: 'sub_qa', customer: 'cus_qa', status: method === 'DELETE' ? 'canceled' : currentStatus, metadata: { supabase_user_id: 'qa-user', offer: 'pro_monthly_intro_v1' }, latest_invoice: { status: invoiceStatus }, items: { data: [{ price: { id: 'price_monthly' }, current_period_end: 1800000000 }] } })
  }
  throw Error(`Unexpected test request: ${method} ${url.origin}${url.pathname}`)
}) as typeof fetch
function reset() { existing = null; currentStatus = 'trialing'; invoiceStatus = 'paid'; dbFailure = false; writes.length = 0; stripeCalls.length = 0 }
function request(body: unknown, authenticated = true) { return new Request('https://billing-qa.supabase.co/test', { method: 'POST', headers: { ...(authenticated ? { Authorization: 'Bearer qa-session' } : {}), origin: 'https://visibletrader.com', 'content-type': 'application/json' }, body: JSON.stringify(body) }) }
async function event(type: string) {
  const payload = JSON.stringify({ type, data: { object: { id: 'sub_qa' } } })
  const timestamp = Math.floor(Date.now() / 1000)
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('qa-webhook-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${payload}`))
  const hex = Array.from(new Uint8Array(sig)).map(x => x.toString(16).padStart(2, '0')).join('')
  return new Request('https://billing-qa.supabase.co/webhook', { method: 'POST', headers: { 'Stripe-Signature': `t=${timestamp},v1=${hex}` }, body: payload })
}
Deno.test('checkout handler authenticates, blocks existing subscribers and sends correct offer to Stripe', async () => {
  reset()
  assert.equal((await checkout(request({ offer: 'pro_monthly_intro_v1' }, false))).status, 401)
  existing = { status: 'active' }
  assert.equal((await checkout(request({ offer: 'pro_monthly_intro_v1' }))).status, 400)
  assert.equal(stripeCalls.length, 0)
  existing = null
  const response = await checkout(request({ offer: 'pro_monthly_intro_v1' }))
  assert.equal(response.status, 200)
  assert.equal((await response.json()).url, 'https://checkout.stripe.com/qa-session')
  const params = new URLSearchParams(stripeCalls[0].body)
  assert.equal(params.get('line_items[1][price]'), 'price_intro')
  assert.equal(params.get('subscription_data[trial_period_days]'), '7')
  assert.equal(params.get('subscription_data[metadata][supabase_user_id]'), 'qa-user')
  assert.equal(params.get('success_url'), 'https://app.visibletrader.com/?checkout=success')
})
Deno.test('checkout fails closed when subscription lookup fails', async () => {
  reset(); dbFailure = true
  assert.equal((await checkout(request({ offer: 'pro_monthly_intro_v1' }))).status, 500)
  assert.equal(stripeCalls.length, 0)
})
Deno.test('signed webhook writes paid introductory access, rejects unpaid access and follows current cancellation state', async () => {
  reset()
  assert.equal((await webhook(await event('customer.subscription.created'))).status, 200)
  assert.equal(writes.at(-1)?.status, 'trialing')
  assert.equal(writes.at(-1)?.plan, 'pro')
  invoiceStatus = 'open'
  await webhook(await event('customer.subscription.updated'))
  assert.equal(writes.at(-1)?.status, 'incomplete')
  currentStatus = 'canceled'
  await webhook(await event('customer.subscription.updated'))
  assert.equal(writes.at(-1)?.status, 'canceled')
  assert.equal((await webhook(new Request('https://billing-qa.supabase.co/webhook', { method: 'POST', body: '{}' }))).status, 400)
})
Deno.test('database webhook failure returns retryable 500 rather than acknowledging lost access writes', async () => {
  reset(); dbFailure = true
  assert.equal((await webhook(await event('customer.subscription.updated'))).status, 500)
})
Deno.test('cancellation checks current Stripe state, preserves paid periods, immediately revokes a trial', async () => {
  reset(); existing = { stripe_subscription_id: 'sub_qa', status: 'trialing' }
  currentStatus = 'active'
  assert.equal((await cancel(request({}))).status, 400)
  assert.equal(stripeCalls.some(x => x.method === 'DELETE'), false)
  currentStatus = 'trialing'
  assert.equal((await cancel(request({}))).status, 200)
  assert.equal(writes.at(-1)?.status, 'canceled')
  assert.equal(stripeCalls.some(x => x.method === 'DELETE'), true)
})
Deno.test('restore fetch after handler tests', () => { globalThis.fetch = originalFetch })
