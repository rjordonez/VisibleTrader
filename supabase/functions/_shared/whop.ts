// Whop helpers shared by create-checkout-session, whop-webhook, cancel-trial
// and request-refund. Pure functions are exported for tests; network calls go
// through whopFetch so the base URL can point at sandbox for testing.

export const WHOP_API_VERSION_DATE = '2026-11-17-3'

export type WhopConfig = {
  baseUrl: string
  apiKey: string
  accountId: string
  planId: string
}

export function whopConfig(env: (name: string) => string | undefined): WhopConfig | null {
  const apiKey = env('WHOP_API_KEY')
  const accountId = env('WHOP_ACCOUNT_ID')
  const planId = env('WHOP_PLAN_ID')
  if (!apiKey || !accountId || !planId) return null
  return {
    baseUrl: env('WHOP_API_BASE') || 'https://api.whop.com/api/v1',
    apiKey,
    accountId,
    planId,
  }
}

export async function whopFetch(
  cfg: WhopConfig,
  path: string,
  init: { method?: string; body?: unknown; idempotencyKey?: string } = {},
  // deno-lint-ignore no-explicit-any
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.apiKey}`,
    'Api-Version-Date': WHOP_API_VERSION_DATE,
    'Content-Type': 'application/json',
  }
  if (init.idempotencyKey) headers['Idempotency-Key'] = init.idempotencyKey
  const res = await fetch(`${cfg.baseUrl}${path}`, {
    method: init.method ?? 'GET',
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`Whop ${init.method ?? 'GET'} ${path} failed (${res.status}): ${data?.error?.message ?? text}`)
  return data
}

// Stable per-user split. A different salt from the 3D Secure test so the two
// experiments don't line up with each other.
export function whopBucket(userId: string): number {
  const s = `whop_split_v1:${userId}`
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % 100
}

export function splitPercent(raw: string | undefined): number {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.floor(n)))
}

export function chooseProvider(userId: string, percent: number): 'stripe' | 'whop' {
  return whopBucket(userId) < percent ? 'whop' : 'stripe'
}

// Whop membership status -> the values ProtectedRoute and Settings understand.
// trialing/active grant access; past_due/canceled don't (same as Stripe today).
export function mapWhopStatus(status: string | null | undefined): string {
  switch (status) {
    case 'trialing': return 'trialing'
    case 'active':
    case 'completed': return 'active'
    case 'past_due':
    case 'unresolved': return 'past_due'
    case 'canceled':
    case 'expired': return 'canceled'
    default: return 'incomplete'
  }
}

// Whop reports a paid trial ($1 first week) as `active` with a short first
// period (7 days) on a 30-day plan, not as `trialing`. Treat a first period
// well under the billing period as the trial so the app shows trial UI and
// sends the sign-up email; after the first full renewal it reads `active`.
// deno-lint-ignore no-explicit-any
export function membershipStatus(m: any): string {
  const mapped = mapWhopStatus(m?.status)
  if (mapped !== 'active' || m?.status === 'completed') return mapped
  const start = Date.parse(m?.current_period_start ?? '')
  const end = Date.parse(m?.current_period_end ?? '')
  const billingDays = Number(m?.billing_period_days ?? 0)
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(billingDays >= 28)) return mapped
  const periodDays = (end - start) / 86_400_000
  return periodDays <= 10 ? 'trialing' : mapped
}

// deno-lint-ignore no-explicit-any
export function membershipRow(m: any) {
  return {
    provider: 'whop' as const,
    whop_membership_id: m.id,
    whop_member_id: m.member_id ?? null,
    whop_user_id: m.user_id ?? m.user?.id ?? null,
    whop_manage_url: m.manage_url ?? null,
    price_id: m.variant_id ?? m.plan?.id ?? null,
    plan: 'pro',
    status: membershipStatus(m),
    cancel_at_period_end: !!m.cancel_at_period_end,
    current_period_end: m.current_period_end ?? m.expires_at ?? null,
    whop_updated_at: m.updated_at ?? null,
    updated_at: new Date().toISOString(),
  }
}

// ---- Standard Webhooks signature check ------------------------------------

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function bytesToB64(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// Whop's docs say to use the ws_ secret "exactly as issued"; the Standard
// Webhooks reference libraries base64-decode the part after the prefix. Try
// each interpretation; every candidate is derived from our own secret.
function candidateKeys(secret: string): Uint8Array[] {
  const keys: Uint8Array[] = [new TextEncoder().encode(secret)]
  const idx = secret.indexOf('_')
  if (idx > 0) {
    const tail = secret.slice(idx + 1)
    keys.push(new TextEncoder().encode(tail))
    try { keys.push(b64ToBytes(tail)) } catch { /* not base64 */ }
  }
  return keys
}

export async function verifyWhopSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  body: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const { id, timestamp, signature } = headers
  if (!id || !timestamp || !signature) return false
  const ts = Number(timestamp)
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > 300) return false
  const provided = signature.split(' ').map((s) => s.split(',')[1]).filter(Boolean) as string[]
  if (!provided.length) return false
  const message = new TextEncoder().encode(`${id}.${timestamp}.${body}`)
  for (const keyBytes of candidateKeys(secret)) {
    const key = await crypto.subtle.importKey('raw', keyBytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const expected = bytesToB64(new Uint8Array(await crypto.subtle.sign('HMAC', key, message)))
    if (provided.some((p) => safeEqual(p, expected))) return true
  }
  return false
}
