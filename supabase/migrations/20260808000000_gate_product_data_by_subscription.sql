-- Every "public read" policy below was `using (true)` — RLS wasn't
-- actually enforcing the paywall at all, since VITE_SUPABASE_ANON_KEY is
-- inherently public (shipped in the JS bundle by design). Anyone with the
-- anon key could read the full product — signals, wallet activity, P&L,
-- leaderboard — directly via the Supabase REST API, completely bypassing
-- ProtectedRoute/Stripe. This closes that: read access to the actual
-- product data now requires an active (trialing or active) subscription,
-- matching what the UI already enforces today.
--
-- security definer so the function can check the caller's own
-- subscriptions row regardless of that table's own RLS (which is
-- correctly owner-scoped) — safe because the query is hardcoded to
-- auth.uid(), there's no way to pass in an arbitrary user id.
create or replace function has_active_subscription()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from subscriptions
    where user_id = auth.uid() and status in ('trialing', 'active')
  )
$$;

alter policy "public read" on opportunities using (has_active_subscription());
alter policy "public read" on opportunity_wallets using (has_active_subscription());
alter policy "public read" on ticker using (has_active_subscription());
alter policy "public read" on opportunity_stats using (has_active_subscription());
alter policy "public read" on opportunity_contributors using (has_active_subscription());
alter policy "public read" on wallet_balances using (has_active_subscription());

-- app_settings itself isn't the product, so select stays public (the
-- dashboard needs to read it before rendering) — but only a paying user
-- should be able to overwrite shared pipeline config, not any signed-up
-- account.
alter policy "authenticated write" on app_settings using (has_active_subscription());

-- Leftover from confirming the GitHub auto-deploy integration works —
-- confirmed (it's been applying every migration this session), explicitly
-- marked "safe to drop once confirmed" in its own migration.
drop table if exists integration_test_ping;
