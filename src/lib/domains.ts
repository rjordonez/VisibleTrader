// Helpers for navigating between the marketing site (visibletrader.com) and
// the app (app.visibletrader.com) — two real origins in prod, so crossing
// between them always needs a plain <a href>/window.location navigation,
// never a router <Link>/navigate(). In dev there's no such subdomain
// running, so these fall back to the existing local `/app`-prefix
// convention on the same origin instead.
export const appUrl = (path: string) =>
  import.meta.env.DEV ? `/app${path}` : `https://app.visibletrader.com${path}`

export const marketingUrl = (path: string) =>
  import.meta.env.DEV ? path : `https://visibletrader.com${path}`

// Path to a route *inside* the dashboard itself (AppShell) — for
// navigate()/<Link to>, not a full URL. Same origin always; just needs
// the dev-only /app prefix mirroring wherever AppShell is mounted (see
// App.tsx's isAppHost / the AppRoutes wildcard route).
export const dashboardPath = (path: string) =>
  import.meta.env.DEV ? `/app${path}` : path

// Same idea as dashboardPath, but for the Terminal — a separate top-level
// route tree (its own chrome, no AppShell nav) mounted at /terminal in prod
// and /app/terminal in dev, mirroring how AppShell itself is mounted.
export const terminalPath = (path: string) =>
  import.meta.env.DEV ? `/app/terminal${path}` : `/terminal${path}`

// OAuth providers (Google/Apple) redirect the browser to a literal
// absolute URL after consent — appUrl()'s relative dev-mode output
// doesn't work for that, so this always returns a full URL in both envs.
export const oauthRedirectUrl = () =>
  import.meta.env.DEV ? `${window.location.origin}/app/` : 'https://app.visibletrader.com/'

// A referral code gets set on visibletrader.com (ReferralRedirect.tsx) but
// needs to still be readable once the visitor actually signs up on
// app.visibletrader.com (OnboardingPage.tsx) — two different origins in
// prod, so localStorage (origin-scoped) can't carry it across that hop the
// way it can for same-origin state. A cookie scoped to the shared parent
// domain can. Dev has no real subdomain split (same origin throughout via
// the /app path prefix), so no domain attribute is needed there.
const REFERRAL_COOKIE = 'vt_referral_code'

export function setReferralCode(code: string) {
  const domainAttr = import.meta.env.DEV ? '' : '; domain=.visibletrader.com'
  document.cookie = `${REFERRAL_COOKIE}=${encodeURIComponent(code)}; path=/; max-age=2592000; SameSite=Lax${domainAttr}`
}

export function getReferralCode(): string | null {
  const match = document.cookie.match(new RegExp(`(?:^|; )${REFERRAL_COOKIE}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}
