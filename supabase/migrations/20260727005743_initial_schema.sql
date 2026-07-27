-- Initial schema for VisibleTrader's signal-tracking tables.
-- Mirrors the shape of the local venter_signals.db SQLite database, upgraded
-- to real Postgres types (numeric for money, timestamptz for timestamps,
-- boolean instead of 0/1 integers).

create table opportunities (
  id bigint generated always as identity primary key,
  condition_id text not null,
  outcome text not null,
  slug text,
  title text,
  cumulative_usd numeric,
  tier integer not null,
  wallet_count integer,
  first_seen timestamptz,
  last_updated timestamptz,
  latest_price numeric,
  category text,
  unique (condition_id, outcome, tier)
);
create index opportunities_condition_outcome_idx on opportunities (condition_id, outcome);
create index opportunities_last_updated_idx on opportunities (last_updated desc);
create index opportunities_category_idx on opportunities (category);

create table opportunity_wallets (
  id bigint generated always as identity primary key,
  condition_id text not null,
  outcome text not null,
  wallet text,
  wallet_name text,
  usd numeric,
  price numeric,
  ts timestamptz,
  exit_ts timestamptz,
  exit_price numeric,
  exit_usd numeric,
  hold_seconds numeric,
  is_scalp boolean,
  market_closed boolean,
  resolved_win boolean,
  resolved_ts timestamptz
);
create index opportunity_wallets_condition_outcome_idx on opportunity_wallets (condition_id, outcome);
create index opportunity_wallets_wallet_idx on opportunity_wallets (wallet);
create index opportunity_wallets_market_closed_idx on opportunity_wallets (market_closed) where market_closed = true;
create index opportunity_wallets_ts_idx on opportunity_wallets (ts);

create table ticker (
  id bigint generated always as identity primary key,
  condition_id text,
  outcome text,
  slug text,
  title text,
  usd numeric,
  price numeric,
  side text,
  tx_hash text,
  wallet text,
  wallet_name text,
  roster_tagged boolean default false,
  category text,
  ts timestamptz,
  epoch double precision
);
create index ticker_epoch_idx on ticker (epoch);

-- These tables are only ever written/read by trusted backend processes
-- (live-signal-service.py, signals-proxy.mjs) connecting with the direct
-- Postgres connection string, not through PostgREST with the anon key.
-- Enable RLS with no policies, which blocks all PostgREST/anon access by
-- default while leaving the direct-connection backend path unaffected.
alter table opportunities enable row level security;
alter table opportunity_wallets enable row level security;
alter table ticker enable row level security;
