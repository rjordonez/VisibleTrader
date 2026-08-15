-- tracked_wallets.added_by referenced auth.users(id) with no ON DELETE
-- behavior at all (every other FK to auth.users either cascades or was
-- deliberately left this way) -- Postgres defaults that to blocking the
-- delete entirely, so any user who ever added one wallet via the Lookup
-- page became impossible to delete from Auth without manually clearing
-- this table first. The tracked wallet itself is independent, useful data
-- regardless of who added it -- cascading the delete would wrongly drop
-- the wallet from tracking too, so SET NULL (losing just the attribution)
-- is the correct behavior here, not CASCADE.
alter table tracked_wallets drop constraint tracked_wallets_added_by_fkey;
alter table tracked_wallets add constraint tracked_wallets_added_by_fkey
  foreign key (added_by) references auth.users(id) on delete set null;
