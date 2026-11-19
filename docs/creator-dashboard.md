# Private creator dashboard

Route: https://app.visibletrader.com/creator-dashboard. The marketing-domain route redirects to the app domain. It sits outside the product subscription/onboarding gate; Google login is required, but creators don't need to buy a subscription. OAuth returns through the existing allowed app callback, then a same-tab session flag restores the dashboard route.

## Permissions

`creator_dashboard_access` is a server-managed allowlist: verified account email plus a canonical creator handle. `*` grants an owner all current creator profiles. Only the service role can change access. The migration seeds the four owner emails authorized by Tavasya; creator email grants are applied separately from Creator Info, matched to the current Post Tracker roster. No invitation emails are automatically sent. Vlad, Lucas and Rami remain uninvited at the owner's request. Tavasya has owner access.

Every report request resolves auth.uid() to the current verified auth.users email, checks the allowlist in the database, and returns only allowed aggregates. No customer identities, raw invoices, roster emails or other creators' data are returned. Removing a grant takes effect on the next request. Raw tables deny anonymous/authenticated reads; private SECURITY DEFINER report code has a fixed empty search path and an explicit auth check, behind a SECURITY INVOKER API wrapper.

Source roster: Visible Trader Expenses / Post Tracker (21 creators, read Nov 18, 2026). Display names are separated from canonical attribution handles. Existing aliases are retained. Creators without an existing referral code receive readable links; those links do not recover missing historical attribution.

## Metrics

- Clicks: referral visits, including repeats.
- Signups: accounts with the creator's saved attribution.
- On trial: unique accounts whose current subscription is live, trialing, and has a trial end in the future. Introductory payments do not convert them to paid subscribers.
- Converted: unique accounts with a positive successful recurring-cycle invoice paid after that subscription's trial ended. A $1 introduction, a failed or zero-value invoice, a direct non-trial subscription, and a proration do not count. Renewals count the person once; cancellation does not erase a past conversion.

The API returns null while relevant historical trial data has not been reconciled. The UI shows a dash instead of an invented zero. Current trial counts and lifetime conversion counts are separate, not an implied same-cohort conversion rate. Invoice-paid history is not net revenue or a commission calculator.

## Click ingestion

`record-creator-click` is a public write-only Edge Function. Only known origins and valid short request bodies are accepted. The server derives a salted daily network hash, never stores raw IP addresses, then calls the service-role-only atomic ingestion RPC. Clients cannot read clicks or call the RPC directly. A stable per-visit event ID deduplicates effect retries. Request keepalive allows the write to finish after redirect; network/storage/browser blocking can still cause undercounting. PostHog events continue separately for diagnostics.

## Rollout

1. Apply both private_creator_dashboard and creator_trial_conversions migrations first, then deploy the updated Stripe webhook. Run the trial-aware reconciliation script to classify historical invoices and current/free trials before treating reports as complete. No billing amounts, pricing, or subscription access statuses are changed by reconciliation.
2. Apply creator grants from the owner-authorized Creator Info email mapping, using service-role/SQL admin access. Never publish this seed file in frontend code.
3. Deploy `record-creator-click` with JWT verification disabled (intentional public visit ingestion; server-held service key is never returned).
4. Import the legacy PostHog click snapshot with a fixed cutoff immediately before frontend rollout. Keep the source query/cutoff for audit. New links have no earlier history.
5. Deploy the frontend through feature → develop → main PRs. Verify owner, creator, unapproved and signed-out states.

## Checks

```sh
PGLITE_PACKAGE_DIR=/tmp/vt-referral-qa node scripts/creator-dashboard-db.test.mjs
deno test --allow-env --allow-net supabase/functions/record-creator-click/index_test.ts
npm run build
```

Browser QA uses an isolated context and mocked backend. Fixture data is local to tests and never shipped as a bypass. Start Vite with dummy Supabase URL `https://creator-preview.supabase.co`, anon key `qa-anon`, PostHog token `qa-token`, host `http://127.0.0.1:5210/analytics`, and `VITE_USE_PROD_DB=false`, on port 5210. Run `scripts/creator-dashboard-browser.test.mjs` with QA_PACKAGE_DIR (temporary Playwright installation), optional CHROMIUM_PATH, and CREATOR_PREVIEW_DATA pointing to a local report fixture array. CREATOR_SCREENSHOT_DIR selects the screenshot destination.

## Local preview

Use `http://127.0.0.1:5210/app/creator-dashboard?preview=1` with the dummy-backend Vite dev server. The local-only recorded snapshot is dynamically imported behind `import.meta.env.DEV`; it cannot bypass production authentication. Unknown historical conversions show a dash. Owner/creator preview selection is local UI only and makes no permission changes. The page uses the same Navbar, Footer, legal/blog container, status banner/list, Manrope font and brand tokens as the public status page.
