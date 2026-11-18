import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import posthog from './lib/posthog'
import { setReferralCode } from './lib/domains'
import { REFERRAL_CODES } from './lib/referralCodes'

// Log the click for analytics and retain the first valid referral cookie.
// SignupAttribution claims it on the first authenticated app session, before
// onboarding. Creator aliases must also be registered in creator_referral_codes.
export default function ReferralRedirect() {
  const { code } = useParams<{ code: string }>()

  useEffect(() => {
    if (code) {
      const creator = REFERRAL_CODES[code] ?? null
      posthog.capture('referral_link_visited', { referral_code: code, creator })
      try {
        if (creator) setReferralCode(code)
      } catch {
        // Cookies disabled — the visit is still logged to PostHog above,
        // this just skips the later-attribution nicety.
      }
    }
    window.location.replace('/')
  }, [code])

  return null
}
