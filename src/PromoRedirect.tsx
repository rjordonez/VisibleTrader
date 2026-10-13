import { useEffect } from 'react'
import posthog from './lib/posthog'
import { setPromoSource } from './lib/domains'

// visibletrader.com/promo — a public marketing link, kept completely
// separate from the UGC creator referral links in ReferralRedirect.tsx
// (different event, different cookie, different account field) so promo
// traffic never gets mixed into creator payouts or creator stats.
//
// Tracking happens in three places:
//   1. PostHog `promo_link_visited` event for every click.
//   2. PostHog person properties (came_from_promo / promo_first_visit_at),
//      so every later event from that visitor — landing pageviews, signup,
//      checkout — can be filtered to promo visitors.
//   3. A `vt_promo_source` cookie on .visibletrader.com, which
//      OnboardingPage.tsx writes onto the Supabase account as
//      `promo_source` if the visitor actually signs up.
export default function PromoRedirect() {
  useEffect(() => {
    posthog.capture('promo_link_visited', {
      promo_source: 'promo',
      $set: { came_from_promo: true },
      $set_once: { promo_first_visit_at: new Date().toISOString() },
    })
    try {
      setPromoSource('promo')
    } catch {
      // Cookies disabled — the PostHog side above still records the visit.
    }
    // Keep any ?utm_... params so the landing pageview carries them too.
    window.location.replace('/' + window.location.search)
  }, [])

  return null
}
