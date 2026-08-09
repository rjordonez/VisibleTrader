-- has_active_subscription() is `security definer`, which Postgres's planner
-- treats as an opaque boundary — it can't inline or cache the check, so it
-- was being re-evaluated per row across opportunities_live's joins
-- (opportunities x opportunity_stats x opportunity_wallets x wallet_balances
-- x leaderboard), turning an instant query into one that hits PostgREST's
-- statement timeout (57014) for any real subscriber with real data. Same
-- security boundary, inlined directly into each policy instead of routed
-- through a function call — a plain EXISTS against subscriptions (unique-
-- indexed on user_id) is cheap and the planner can actually optimize it.
alter policy "public read" on opportunities using (
  exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'))
);
alter policy "public read" on opportunity_wallets using (
  exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'))
);
alter policy "public read" on ticker using (
  exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'))
);
alter policy "public read" on opportunity_stats using (
  exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'))
);
alter policy "public read" on opportunity_contributors using (
  exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'))
);
alter policy "public read" on wallet_balances using (
  exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'))
);
alter policy "authenticated write" on app_settings using (
  exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'))
);
alter policy "authenticated insert" on tracked_wallets with check (
  exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'))
);
alter policy "authenticated delete" on tracked_wallets using (
  exists (select 1 from subscriptions where user_id = auth.uid() and status in ('trialing', 'active'))
);

drop function if exists has_active_subscription();
