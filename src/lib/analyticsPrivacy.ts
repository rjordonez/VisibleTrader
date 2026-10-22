const AUTH_PARAMETERS = new Set([
  'access_token', 'refresh_token', 'provider_token', 'provider_refresh_token',
  'id_token', 'token', 'token_hash', 'code', 'state', 'token_type', 'expires_in', 'expires_at',
])

export function sanitizeAnalyticsUrl(value: string): string {
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol)) return value
    // OAuth implicit-flow credentials arrive in the fragment. Analytics
    // must never depend on Supabase consuming it before the first pageview.
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) {
      if (AUTH_PARAMETERS.has(key.toLowerCase())) url.searchParams.delete(key)
    }
    return url.href
  } catch { return value }
}

export function sanitizeAnalyticsProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const sanitize = (value: unknown): unknown => {
    if (typeof value === 'string') return sanitizeAnalyticsUrl(value)
    if (Array.isArray(value)) return value.map(sanitize)
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitize(item)]))
    }
    return value
  }
  return sanitize(properties) as Record<string, unknown>
}
