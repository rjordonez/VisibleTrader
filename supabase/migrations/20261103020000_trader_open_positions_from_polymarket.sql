-- The Leaderboard's open-position counts now come from Polymarket's data
-- API (live-signal-service.py refresh_trader_open_positions, the same call
-- the trader profile's Active tab makes). Counting from opportunity_wallets
-- was wrong whenever a sale or redemption was never recorded: Stavenson
-- showed "1 open" for a Hong Kong Open match the profile (and Polymarket)
-- showed as closed. The SQL refresh and the wallet-keyed partial index it
-- needed go; the index was only write overhead on the busiest table.
-- trader_scores.open_positions / open_usd stay, written by the service.
drop function if exists public.refresh_trader_open_positions();
drop index concurrently if exists opportunity_wallets_open_wallet_idx;
