-- Queue table fed by the Alchemy Custom Webhook (supabase/functions/alchemy-webhook) —
-- replaces the old last_trade_price WebSocket path as the source of trade
-- discovery for scripts/live-signal-service.py, which polls unprocessed rows
-- here instead of reading last_trade_price off Polymarket's own WS. See the
-- 2026-08-26 investigation: the WS path measured a 60% miss rate on rapid
-- trade bursts even on actively-watched markets, while price_change stayed
-- reliable — this table only replaces trade discovery, not mark-to-market.
create table onchain_fills (
  id bigint generated always as identity primary key,
  tx_hash text not null,
  log_index int not null,
  maker text not null,
  taker text not null,
  side int not null,
  token_id text not null,
  maker_amount_filled numeric not null,
  taker_amount_filled numeric not null,
  block_timestamp timestamptz not null,
  received_at timestamptz not null default now(),
  processed boolean not null default false,
  -- Idempotency against Alchemy's at-least-once webhook redelivery — a
  -- duplicate POST for the same log just no-ops via ON CONFLICT DO NOTHING.
  -- log_index (not just tx_hash) matters: confirmed live on 2026-08-26 that
  -- a single transaction can contain multiple OrderFilled logs.
  unique (tx_hash, log_index)
);

create index onchain_fills_unprocessed_idx on onchain_fills (id) where processed = false;

alter table onchain_fills enable row level security;
-- No policies — this table is only ever touched by the alchemy-webhook Edge
-- Function (service role, bypasses RLS) and live-signal-service.py (direct
-- Postgres connection, also bypasses RLS). Never queried from the client.
