-- The exact-timestamp grouping heuristic in JournalCalendar assumed all
-- fills of one order share one instant, which only holds for immediate-fill
-- orders — a resting limit order can fill in pieces at different times.
-- Storing Polymarket's own order id lets grouping be exact instead of guessed.
alter table public.polymarket_trades add column order_id text;
