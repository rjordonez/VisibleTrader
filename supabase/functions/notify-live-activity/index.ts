import { createInternalHandler } from './internal-auth.ts'

// Pushes an updated ContentState to every registered VisibleTrader Live
// Activity via APNs. Invoke this from a Supabase Database Webhook on your
// signups table (any event is fine — it always re-fetches the current
// count rather than trusting the webhook payload), or call it directly.
//
// Required secrets (supabase secrets set ...):
//   APNS_KEY_ID        - Key ID from the Apple Developer portal
//   APNS_TEAM_ID       - Your Apple Developer Team ID
//   APNS_PRIVATE_KEY   - Full contents of the .p8 file (PEM, incl. header/footer)
//   APNS_TOPIC         - Your app's bundle ID, e.g. "app.VisibleTrader"
//   APNS_ENVIRONMENT   - "sandbox" for Debug/dev builds, "production" for
//                        TestFlight/App Store builds. Defaults to "sandbox".
//
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

const VIEW_GOAL = 100_000
const DEADLINE = new Date(Date.UTC(2026, 8, 30, 23, 59, 59)) // Sept 30, 2026

function daysLeft(now: Date): number {
  const msPerDay = 24 * 60 * 60 * 1000
  const startOfNow = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const startOfDeadline = Date.UTC(
    DEADLINE.getUTCFullYear(),
    DEADLINE.getUTCMonth(),
    DEADLINE.getUTCDate()
  )
  return Math.max(0, Math.round((startOfDeadline - startOfNow) / msPerDay))
}

function base64url(bytes: Uint8Array): string {
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function base64urlFromString(s: string): string {
  return base64url(new TextEncoder().encode(s))
}

function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const base64 = pem
    .replace(/-----BEGIN [^-]+-----/, "")
    .replace(/-----END [^-]+-----/, "")
    .replace(/\s+/g, "")
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function makeApnsJwt(keyId: string, teamId: string, privateKeyPem: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(privateKeyPem),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  )

  const header = base64urlFromString(JSON.stringify({ alg: "ES256", kid: keyId }))
  const claims = base64urlFromString(
    JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) })
  )
  const signingInput = `${header}.${claims}`

  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput)
  )

  return `${signingInput}.${base64url(new Uint8Array(signature))}`
}

Deno.serve(createInternalHandler(handle, () => Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')))

async function handle(): Promise<Response> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  const keyId = Deno.env.get("APNS_KEY_ID")!
  const teamId = Deno.env.get("APNS_TEAM_ID")!
  const privateKeyPem = Deno.env.get("APNS_PRIVATE_KEY")!
  const topic = Deno.env.get("APNS_TOPIC")!
  const environment = Deno.env.get("APNS_ENVIRONMENT") ?? "sandbox"
  const apnsHost =
    environment === "production" ? "api.push.apple.com" : "api.sandbox.push.apple.com"

  // 1. Current count, straight from the same RPC the app calls.
  const countResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/public_user_count`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  })
  const countBody = await countResponse.json()
  const currentUsers = typeof countBody === "number" ? countBody : countBody?.[0]?.public_user_count

  if (typeof currentUsers !== "number") {
    return new Response(JSON.stringify({ error: "could not resolve currentUsers", countBody }), {
      status: 500,
    })
  }

  // 1b. Current total views, straight from the latest scraper batch — no
  // extrapolation/smoothing, just the real number.
  const viewsResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/public_total_view_count`, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({}),
  })
  const viewsBody = await viewsResponse.json().catch(() => null)
  const rawViews = typeof viewsBody === "number" ? viewsBody : 0
  const currentViews = Math.min(rawViews, VIEW_GOAL)

  // 1c. Paid subscriber count (manually tracked, no payment processor yet).
  const paidSubscribersResponse = await fetch(
    `${supabaseUrl}/rest/v1/rpc/public_paid_subscriber_count`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }
  )
  const paidSubscribersBody = await paidSubscribersResponse.json().catch(() => null)
  const currentPaidSubscribers = typeof paidSubscribersBody === "number" ? paidSubscribersBody : 0

  // 2. Every registered push token.
  const tokensResponse = await fetch(
    `${supabaseUrl}/rest/v1/live_activity_tokens?select=push_token`,
    {
      headers: {
        apikey: serviceRoleKey,
        Authorization: `Bearer ${serviceRoleKey}`,
      },
    }
  )
  const tokens: { push_token: string }[] = await tokensResponse.json()

  // 3. One APNs JWT, reused across all pushes in this invocation.
  const jwt = await makeApnsJwt(keyId, teamId, privateKeyPem)

  const contentState = {
    currentUsers,
    daysLeft: daysLeft(new Date()),
    currentViews,
    currentPaidSubscribers,
  }

  const results = await Promise.all(
    tokens.filter(({ push_token }) => /^[a-fA-F0-9]{1,512}$/.test(push_token)).map(async ({ push_token }) => {
      const response = await fetch(`https://${apnsHost}/3/device/${push_token}`, {
        method: "POST",
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-topic": `${topic}.push-type.liveactivity`,
          "apns-push-type": "liveactivity",
          // Priority 10 (immediate) — this now fires once per hour (right
          // after each real scrape), nowhere near the metered budget.
          "apns-priority": "10",
        },
        body: JSON.stringify({
          aps: {
            timestamp: Math.floor(Date.now() / 1000),
            event: "update",
            "content-state": contentState,
          },
        }),
      })

      // 410 / 400 BadDeviceToken means the activity ended or the token is
      // stale — stop pushing to it.
      if (response.status === 410 || response.status === 400) {
        await fetch(
          `${supabaseUrl}/rest/v1/live_activity_tokens?push_token=eq.${push_token}`,
          {
            method: "DELETE",
            headers: {
              apikey: serviceRoleKey,
              Authorization: `Bearer ${serviceRoleKey}`,
            },
          }
        )
      }

      return { status: response.status }
    })
  )

  return new Response(JSON.stringify({ sent: results.filter(r => r.status === 200).length, failed: results.filter(r => r.status !== 200).length }), {
    headers: { "Content-Type": "application/json" },
  })
}
