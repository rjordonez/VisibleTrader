-- Manually-entered daily P&L for the new Journal calendar page (sidebar
-- "Personal" section) — this is the user's own self-reported numbers, not
-- anything derived from tracked wallets, so it lives in its own table
-- rather than piggybacking on wallet_positions/opportunity_wallets.
create table if not exists public.personal_pnl_entries (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users(id) on delete cascade,
    entry_date date not null,
    amount numeric not null,
    note text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    -- One entry per day per user — the UI edits in place rather than
    -- letting multiple entries pile up on the same date.
    unique (user_id, entry_date)
);

create index if not exists personal_pnl_entries_user_date_idx
    on public.personal_pnl_entries (user_id, entry_date desc);

alter table public.personal_pnl_entries enable row level security;

create policy "users manage their own pnl entries"
    on public.personal_pnl_entries
    for all
    to authenticated
    using (user_id = auth.uid())
    with check (user_id = auth.uid());
