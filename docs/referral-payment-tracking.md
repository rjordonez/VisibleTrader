# Creator signup and payment tracking

The database is authoritative; PostHog clicks and onboarding events are diagnostic.

## Attribution

- First valid creator link in the browser's 30-day cookie window wins.
- An auth.users trigger creates a signup record at account creation, independent of onboarding. Email signup metadata can include referral_code and is captured in that transaction.
- The current UI uses Google/Apple OAuth. Custom metadata cannot be passed through signInWithOAuth; SignupAttribution claims the browser cookie on the first authenticated app callback, before onboarding or pricing renders. Database failures display a retry instead of silently losing attribution.
- A first callback with no valid code finalizes as direct. Finalized referrals cannot be changed by the client. Existing accounts are imported and finalized during migration, including unknown ones, so later clicks cannot claim old customers.
- OAuth accounts that never return to the app remain pending and appear explicitly in the signup report. Cookies blocked/deleted or signup on another browser/device cannot be reliably attributed. Missing historical creator attribution stays unknown; never infer it from clicks alone.
- Add new links to both src/lib/referralCodes.ts and creator_referral_codes in a migration. Aliases map to a single creator; the legacy vladdi.trades code remains recognized.

## Payments

Stripe checkout copies the canonical account referral into session/subscription metadata. It refuses checkout while signup capture is pending. The webhook saves successful positive-value subscription invoices by unique Stripe invoice ID; retries, invoice.paid and invoice.payment_succeeded deliveries, and reconciliation cannot duplicate an invoice.

Free invoices, failed payments, manually marked-paid invoices, and non-subscription invoices do not count. Initial $1 monthly introductions are classified separately from other payments. Renewals create more invoices, never more unique customers. Cancellation does not delete payments. Historical signup and payment counts, creator credit, and a stable payer key are preserved even if the auth account is deleted. Stripe test invoices are excluded from the production report.

"Paid" means a positive paid subscription invoice, including an introductory payment. "Non-intro paying customers" means at least one non-intro invoice; it is not a claim that every such invoice was a full-price renewal (discounts/proration may apply). Revenue is **gross invoice amount paid**, before refunds, disputes and Stripe fees, in integer currency minor units. This is not a net revenue or commission calculator.

## Deployment and historical reconciliation

1. Apply 20261118195940_referral_payment_tracking.sql first, then deploy stripe-webhook and create-checkout-session, then deploy the frontend. Do not ship the frontend before the RPC exists. Do not accept reports as complete until reconciliation finishes. Existing old browser bundles can still operate during rollout; schedule a close deployment window.
2. Verify the live Stripe webhook endpoint includes invoice.paid (already handled previously), invoice.payment_succeeded, invoice.payment_failed and the existing subscription lifecycle events. Failed ledger writes return HTTP 500 for Stripe retries.
3. With server credentials loaded securely into the environment, preview history:
   `deno run --allow-env --allow-net scripts/reconcile-referral-payments.ts`
4. Inspect any failures, then repeat with `--apply`. This inserts only absent invoices and is safe to resume/repeat. No historical Stripe or production writes happen in dry-run. Deleted/missing accounts or subscriptions missing account metadata are reported as failures, not silently attributed.
5. Compare live invoice totals and sample users against Stripe. Inspect pending and legacy_unknown signup counts. Old unknown attribution cannot be recovered by payment backfill.

As service_role / SQL admin:

```sql
select * from public.creator_referral_signups order by creator nulls last;
select * from public.creator_referral_payments order by creator nulls last, currency;
```

Creator NULL is unattributed, including direct, pending, legacy unknown, or deleted accounts without a historical claim. Paying customers count once per creator **and currency**; do not sum unique counts across currencies. No historical payment counts are complete before the invoice backfill.

## Verification

```sh
deno test --allow-env --allow-net scripts/billing_handlers_test.ts supabase/functions/stripe-webhook/subscription_test.ts supabase/functions/stripe-webhook/payments_test.ts
deno check scripts/reconcile-referral-payments.ts
npm run build
```

An isolated embedded Postgres test exercises the full migration, trigger/RPC execution, immutable attribution, client restrictions, invoice deduplication, aliases, test-mode exclusion and deletion retention, without contacting production:

```sh
npm install --prefix /tmp/vt-referral-qa @electric-sql/pglite@0.5.16
PGLITE_PACKAGE_DIR=/tmp/vt-referral-qa node scripts/referral-tracking-db.test.mjs
```

Before production rollout, verify real OAuth return and live Stripe delivery in staging. Embedded Postgres checks do not exercise the hosted Auth service, webhook endpoint configuration or real card processing.

Browser regression test (all backend requests are mocked; uses a fresh isolated browser context):

```sh
VITE_SUPABASE_URL=https://referral-qa.supabase.co VITE_SUPABASE_ANON_KEY=qa-anon VITE_USE_PROD_DB=false VITE_POSTHOG_PROJECT_TOKEN=qa-token VITE_POSTHOG_HOST=http://127.0.0.1:5198/analytics npm run dev -- --host 127.0.0.1 --port 5198
# In another terminal:
npm install --prefix /tmp/vt-referral-qa playwright@1.65.1
QA_PACKAGE_DIR=/tmp/vt-referral-qa CHROMIUM_PATH=/path/to/chromium node scripts/referral-tracking-browser.test.mjs
```

Reference: [Supabase OAuth flow](https://supabase.com/docs/guides/auth/social-sign-in/auth-google), [Stripe invoice event definitions](https://docs.stripe.com/api/events/types).
