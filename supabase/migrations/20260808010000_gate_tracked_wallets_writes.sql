-- Same gap as app_settings, found on a second pass: tracked_wallets feeds
-- directly into live-signal-service.py's roster (see its own migration
-- comment) — adding or deleting a row here changes what the whole product
-- tracks for every user, not just the caller. Its insert/delete policies
-- were "any authenticated user", not scoped to paying subscribers, so a
-- signed-up-but-not-subscribed account could add junk wallets or delete
-- ones paying customers rely on. Select stays public — same reasoning as
-- app_settings: the Lookup page needs to read it before a user is
-- necessarily subscribed, and knowing an address is tracked isn't itself
-- the product (the wallet's actual trade activity already requires a
-- subscription via opportunity_wallets/wallet_positions).
alter policy "authenticated insert" on tracked_wallets with check (has_active_subscription());
alter policy "authenticated delete" on tracked_wallets using (has_active_subscription());
