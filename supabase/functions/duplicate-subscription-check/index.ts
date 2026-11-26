// Daily safety net: emails the support inbox a list of customers who have
// more than one live Stripe subscription, so a duplicate gets fixed before it
// charges twice. Changes nothing itself. Called by the scheduled GitHub
// Action in .github/workflows/duplicate-subscription-check.yml with a shared
// secret, since a cron job can't carry a user's auth.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { duplicatesEmail, findDuplicates, ignoreList, LIVE_STATUSES, type LiveSub } from './duplicates.ts'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

async function listLive(): Promise<LiveSub[]> {
  const out: LiveSub[] = []
  for (const status of LIVE_STATUSES) {
    let after: string | undefined
    for (;;) {
      const qs = new URLSearchParams({ status, limit: '100' })
      if (after) qs.set('starting_after', after)
      const res = await fetch(`https://api.stripe.com/v1/subscriptions?${qs}`, {
        headers: { Authorization: `Bearer ${Deno.env.get('STRIPE_SECRET_KEY')}` },
      })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error?.message || 'Stripe list failed')
      out.push(...body.data)
      if (!body.has_more) break
      after = body.data[body.data.length - 1].id
    }
  }
  return out
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('DUPLICATE_CHECK_SECRET')
  if (!secret || req.headers.get('x-check-secret') !== secret) return json({ error: 'unauthorized' }, 401)

  try {
    const dups = findDuplicates(await listLive(), ignoreList(Deno.env.get('DUPLICATE_CHECK_IGNORE_USERS')))
    if (dups.length === 0) return json({ duplicates: 0 })

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const emails: Record<string, string> = {}
    for (const d of dups) {
      const { data } = await supabase.auth.admin.getUserById(d.userId)
      if (data?.user?.email) emails[d.userId] = data.user.email
    }

    const apiKey = Deno.env.get('RESEND_API_KEY')
    if (apiKey) {
      const { subject, html } = duplicatesEmail(dups, emails)
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          // One alert per day at most, even if the job is re-run.
          'Idempotency-Key': `duplicate-check-${new Date().toISOString().slice(0, 10)}-${dups.map((d) => d.userId).join(',').slice(0, 200)}`,
        },
        body: JSON.stringify({
          from: Deno.env.get('RESEND_FROM') || 'Visible Trader <billing@visibletrader.com>',
          to: Deno.env.get('REFUND_REQUEST_TO') || 'hq@visibletrader.com',
          subject,
          html,
        }),
      })
      if (!res.ok) console.error('duplicate alert email failed', res.status, await res.text())
    }
    return json({ duplicates: dups.length, users: dups.map((d) => d.userId) })
  } catch (err) {
    console.error('duplicate-subscription-check failed', err)
    return json({ error: (err as Error).message }, 500)
  }
})
