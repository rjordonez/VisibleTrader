import { useEffect } from 'react'
import posthog from './lib/posthog'
import { setPromoSource } from './lib/domains'

// visibletrader.com/promo — a public marketing link. Works exactly like the
// UGC creator referral links in ReferralRedirect.tsx, but is kept separate
// from them (its own event, cookie, and account field) so promo traffic
// never gets mixed into creator stats or payouts:
//   1. PostHog `promo_link_visited` event for every click.
//   2. A `vt_promo_source` cookie on .visibletrader.com, which
//      OnboardingPage.tsx writes onto the Supabase account as
//      `promo_source` if the visit actually turns into a signup.
export default function PromoRedirect() {
  useEffect(() => {
    posthog.capture('promo_link_visited', { promo_source: 'promo' })
    try {
      setPromoSource('promo')
    } catch {
      // Cookies disabled — the visit is still logged to PostHog above,
      // this just skips the later-attribution nicety.
    }
    // Keep any ?utm_... params so the landing pageview carries them too.
    window.location.replace('/' + window.location.search)
  }, [])

  return null
}
