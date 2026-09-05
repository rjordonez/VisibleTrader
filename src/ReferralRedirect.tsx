import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import posthog from './lib/posthog'
import { setReferralCode } from './lib/domains'

// A referral link's whole job: record who sent this visitor, then get out
// of the way. Codes are opaque random strings, not creator handles — a
// predictable /r/<handle> link would let anyone guess another creator's
// link and either steal their credit or spoof clicks against them. The
// code->creator map below is the only place that link exists; it's fine as
// a plain hardcoded object since affiliate applications are already
// reviewed and assigned by hand, one at a time.
const REFERRAL_CODES: Record<string, string> = {
  guukq8: 'toby.bets',
  qx3ezk: 'paxx.prints',
  gb6k9u: 'vladdi.trades',
  cvxysr: 'lincolnpredicts',
  qjyzmf: 'rextracks',
  qycjpu: 'rex_predicts',
  '2js266': 'nate.predicts',
  eztm6e: 'rudrapredicts',
  '2p348p': 'dretrdzzz',
  '6dek9j': 'cha0spredicts',
}

// `referral_link_visited` is queryable in PostHog by both the raw code and
// the resolved creator name; OnboardingPage.tsx reads the cookie set below
// (via lib/domains.ts's setReferralCode/getReferralCode — a cookie, not
// localStorage, since the visitor lands here on visibletrader.com but signs
// up on the separate app.visibletrader.com origin) to attach it to the real
// account if the visit actually turns into a signup.
export default function ReferralRedirect() {
  const { code } = useParams<{ code: string }>()

  useEffect(() => {
    if (code) {
      const creator = REFERRAL_CODES[code] ?? null
      posthog.capture('referral_link_visited', { referral_code: code, creator })
      try {
        setReferralCode(code)
      } catch {
        // Cookies disabled — the visit is still logged to PostHog above,
        // this just skips the later-attribution nicety.
      }
    }
    window.location.replace('/')
  }, [code])

  return null
}
