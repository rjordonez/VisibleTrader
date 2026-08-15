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

// OAuth providers (Google/Apple) redirect the browser to a literal
// absolute URL after consent — appUrl()'s relative dev-mode output
// doesn't work for that, so this always returns a full URL in both envs.
export const oauthRedirectUrl = () =>
  import.meta.env.DEV ? `${window.location.origin}/app/` : 'https://app.visibletrader.com/'
