// Called once per authenticated session (see ProtectedRoute.tsx) to record
// which country a user signed up from. Neither signup path (email/password
// or Google/Apple OAuth) goes through code we control — supabase-js calls
// Supabase's Auth API directly from the browser — so there's no request of
// ours to read a geo header off at signup time. Instead this runs
// afterward, from any authenticated page load, and is idempotent (skips
// once a user already has a country) so callers can fire it unconditionally
// without their own "have I already done this" bookkeeping.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
      return new Response(JSON.stringify({ error: 'not authenticated' }), {
        status: 401,
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    if (user.user_metadata?.country) {
      return new Response(JSON.stringify({ skipped: true }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    // Supabase's edge runtime sits behind Cloudflare, which always sets
    // this on the request reaching origin — no third-party geolocation
    // lookup needed. "XX" is Cloudflare's own "couldn't determine" sentinel
    // (e.g. some VPNs/proxies); treated the same as missing.
    const country = req.headers.get('cf-ipcountry')
    if (!country || country === 'XX') {
      return new Response(JSON.stringify({ skipped: true, reason: 'no country header' }), {
        headers: { ...corsHeaders, 'content-type': 'application/json' },
      })
    }

    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    await serviceClient.auth.admin.updateUserById(user.id, {
      user_metadata: { ...user.user_metadata, country },
    })

    return new Response(JSON.stringify({ country }), {
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'content-type': 'application/json' },
    })
  }
})
