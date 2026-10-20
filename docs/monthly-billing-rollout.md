# Pro monthly introductory offer

New purchases use `pro_monthly_intro_v1`: $1 upfront for seven days, then
$160 every calendar month, plus applicable tax. The $5.33/day display is an
approximation based on a 30-day month. It is not a daily charge.

Stripe configuration (Visible Trader live account):

- Monthly recurring price: `price_1UST6hKH5ILbHctDyZlhDkX9`
- One-time first-week price: `price_1UST6xKH5ILbHctD4EwdrmDG`
- Existing weekly price remains unchanged: `price_1U82oqKH5ILbHctDURWScRUa`

Supabase secrets:

- `STRIPE_PRICE_PRO_MONTHLY`: monthly price above
- `STRIPE_PRICE_PRO_INTRO_WEEK`: one-time price above
- `STRIPE_LEGACY_CHECKOUT_ENABLED`: `true` only during deployment overlap;
  `false` after the new frontend is live.

The frontend selects a server-owned offer, so it needs no new Vercel price
variable. Existing weekly subscriptions, gift links and access-code redemption
are not migrated. Previously opened weekly Stripe Checkout Sessions keep their
original disclosed terms until they complete or expire; stale weekly pages
cannot create new weekly sessions after the legacy switch is disabled.

## Verification

```
deno test --allow-env scripts/billing_handlers_test.ts supabase/functions/create-checkout-session/checkout_test.ts supabase/functions/stripe-webhook/subscription_test.ts
deno run --allow-read=.env.local --allow-net=api.stripe.com --allow-write=/private/tmp/venter-monthly-test.json scripts/test_monthly_billing.ts
npm run build
```

The integration test requires a TEST key in `STRIPE_SECRET_KEY` in the ignored
`.env.local`. It refuses live keys. It creates synthetic customers and a test
clock, verifies the $1 charge, advances seven days, verifies a $160 monthly
renewal, checks cancellation and declined renewal, and removes the test clock
and customers. It archives its test prices and expires its checkout session.

The webhook reads current Stripe state to handle out-of-order delivery and
only grants introductory access after the upfront invoice is paid. Introductory
cancellations, including those scheduled through the billing portal, are
immediate. Cancellation of an existing paid period keeps its existing policy.
The cancellation endpoint checks current Stripe status before deleting.

## Deployment order and rollback

1. Configure new prices and set legacy checkout enabled.
2. Deploy `stripe-webhook`, `cancel-trial`, and `create-checkout-session`.
3. Enable `checkout.session.async_payment_succeeded`, `invoice.paid`, and
   `invoice.payment_failed` on the existing active Supabase webhook endpoint,
   preserving its existing event subscriptions and signing secret.
4. Ship the frontend through a feature PR into `develop`, then a `develop` to
   `main` PR. Verify production assets and pricing in the browser.
5. Disable legacy checkout. Verify the old weekly request is rejected and new
   offer requests reach authentication successfully.

If the frontend deployment fails, leave legacy checkout enabled while fixing
or reverting the frontend. If rolling back after monthly purchases have begun,
keep monthly price mapping and monthly webhook processing: those customers
must keep the terms they purchased. Never migrate or cancel existing customer
subscriptions as part of rollback.
