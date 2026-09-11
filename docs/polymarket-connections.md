# Polymarket account connections

US availability fix (2026-09-11): credentials are verified through an authenticated activity read. Positions and activity load independently; failed resources are omitted and described in `resource_errors`, never reported as empty or zero. Credential rejection still fails the request. `last_synced_at` only advances after both resources succeed. Live diagnostics found activities returning 200 while positions (limits 1, 100, and no query) and balances returned 503/code 14. This isolates the observed failure to those upstream reads but does not establish a platform-wide outage.

Activity history is paginated for both venues: up to 500 trades are fetched per snapshot (International uses offset pages; US uses its `nextCursor`), with an explicit limited-history flag when more remains.

Connections are managed at `/settings/connections` (locally `/app/settings/connections`), with entry points in the account menu, Settings, and Journal. The legacy `/connections` route redirects there. Journal is the personal sidebar destination and contains Overview, Trades, and Calendar views.

## Current milestone

- International browser-wallet connection discovers injected wallets with EIP-6963 and falls back to `window.ethereum`. The user signs a plain, tracking-only message. A five-minute, single-use server challenge binds the signature to the signed-in VisibleTrader user and signer. The server recovers the signer and resolves the associated Polymarket account wallet through Gamma's public-profile endpoint.
- Public profile tracking accepts an account address, profile link, or exact username. A matching-profile preview precedes saving. Public tracking is explicitly unverified; supplying an address cannot claim ownership.
- Connections persist per VisibleTrader user. The page reads the largest 100 positions and latest 50 trades, refreshing every minute while visible. It labels those limits and retains the last successful snapshot on provider errors. There is no full-history import or background sync worker in this milestone.
- Polymarket US uses a guided Key ID / Secret Key form and the existing `polymarket-us-connect` function. Platform selection, wallet/profile methods, account confirmation, pending states, errors, and success feedback share one dialog flow.
- Journal shows current positions and the latest 50 trades per account. Reviewing a trade opens its local calendar day with recent activity and a persistent daily reflection. Manual P&L remains explicitly labeled and is not combined with trade amounts. A reflection without an amount records zero using the existing daily-entry schema. Complete historical imports, automatic realized P&L, win rate, performance charts, and individual trade tags are not implemented by this UI change.
- No orders, token approvals, deposits, or transfers are implemented. The current wallet signature grants no trading authorization. Disconnecting does not delete manual journal entries.
- Browser wallets with externally owned signers are supported. WalletConnect QR sessions and smart-contract signer verification are not implemented. Email/Google users can track their public profile without exporting a private key.

## Deployment

Development target: `lfebcdrczausvohsyxfa`, the persistent `develop` branch under `vohtqodprqpobvvcdypy`. Local `.env.local` already selects it with `VITE_USE_PROD_DB=false`.

Applied migration: `supabase/migrations/20260911030413_polymarket_connections.sql`. Its version matches the development migration ledger. Deployed function: `polymarket-connect`, with `index.ts`, `handler.ts`, and `domain.ts` from `supabase/functions/polymarket-connect/`.

The function has gateway JWT verification disabled because it explicitly validates every non-preflight request with `supabase.auth.getUser()` before accessing any account data. Standard Supabase function environment variables are sufficient; there are no Polymarket secrets to configure. The service role is only used inside the function, and every database operation is scoped to the authenticated user.

RLS permits users to read/delete only their own connection. Client insert/update is denied. Challenge rows are inaccessible to browser roles. No signatures, private keys, API credentials, or portfolio history are stored in the connections table. Disconnect removes saved connection metadata and outstanding challenges; it does not modify the Polymarket account.

The current integration uses the same public Data API v1 family as the existing wallet-search function. The live profile, positions, and activity routes were checked successfully. Migrating to v2 requires evaluating its separate authentication requirements.

## Validation

```sh
npm run build
npx eslint src/app/connections supabase/functions/polymarket-connect src/app/JournalPage.tsx src/app/SettingsPage.tsx
DENO_NO_PACKAGE_JSON=1 deno test --no-config --node-modules-dir=none --allow-env supabase/functions/polymarket-connect/handler_test.ts
```

Backend tests cover invalid JWTs, address parsing, wrong signatures, expired challenges, replay, cross-user signature reuse, unverified tracking, failed lookups, snapshot isolation, upstream errors, and disconnection.

The browser regression script uses Playwright with mocked authentication, venue responses, wallet prompts, and journal persistence. It checks desktop (1440px) and mobile (390px), platform selection, US credentials with synthetic values, wallet rejection/account switching, profile confirmation, journal review/save, restored connections, stale-data errors, disconnection, legacy redirects, layout overflow, and runtime errors. It produces screenshots using synthetic data.

```sh
# Install outside the project to avoid changing application dependencies.
npm install --prefix /tmp/venter-browser-check playwright
/tmp/venter-browser-check/node_modules/.bin/playwright install chromium
npm run dev -- --host 127.0.0.1 --port 5180
# In another terminal:
PLAYWRIGHT_MODULE_PATH=/tmp/venter-browser-check/node_modules/playwright node scripts/test-polymarket-connections.mjs
```

Optional environment variables: `CONNECTION_TEST_ORIGIN`, `CONNECTION_TEST_ARTIFACTS`, and `PLAYWRIGHT_CHROMIUM_EXECUTABLE` (for an existing compatible Chromium).

Development verification also checked database grants/RLS and used two temporary users inside a rolled-back transaction to assert account isolation and deny ownership updates/challenge access. The deployed function rejects anonymous calls with HTTP 401. A live, authenticated browser-wallet connection still needs acceptance testing with a user's actual Polymarket wallet; no real wallet or trade was used in automated tests.

Existing repository lint has an unrelated `react-hooks/set-state-in-effect` finding in `src/app/index.tsx`'s mobile navigation effect. The new modules pass targeted lint. Build warnings for the existing Lottie dependency and large bundles remain.

See [US connection research](research/polymarket-us-connection.md) for the proposed guided key flow and provider-assisted alternatives.
