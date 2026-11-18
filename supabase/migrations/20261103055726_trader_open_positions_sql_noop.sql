-- Superseded by live-signal-service.py reading Polymarket's data API; kept as
-- a no-op until the deployed service stops calling it, then dropped.
create or replace function public.refresh_trader_open_positions()
returns integer
language sql
as $function$ select 0 $function$;
