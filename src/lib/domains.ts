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
