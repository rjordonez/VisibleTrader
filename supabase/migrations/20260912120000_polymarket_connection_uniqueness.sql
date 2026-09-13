-- A verified wallet signature proves control of that address at connect time,
-- so two different VisibleTrader accounts must not both hold a verified claim
-- on the same wallet. Unverified rows (the "track a trader" flow, where
-- verified_at is null) are exempt: many users may legitimately track the
-- same public wallet they don't own.
create unique index polymarket_connections_signer_address_verified_idx
  on public.polymarket_connections (signer_address)
  where verified_at is not null;

-- Unlike a wallet lookup, a Polymarket US API key is a private, reusable
-- credential with no "track someone else's" use case, so any two rows
-- sharing a key_id are always a collision.
alter table public.polymarket_us_connections
  add constraint polymarket_us_connections_key_id_key unique (key_id);
