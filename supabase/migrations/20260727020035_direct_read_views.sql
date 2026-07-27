-- Moves the read path from a local Node proxy (signals-proxy.mjs) to direct
-- Supabase access from the browser. The write path is unaffected: the
-- Postgres connection live-signal-service.py uses (the raw postgres role)
-- bypasses RLS by default, so none of this touches how trades get written.

-- ── Public read access on the existing tables ──
-- These were created RLS-enabled with zero policies (fully locked). This is
-- public market data, not per-user, so a blanket read policy is correct.
grant select on opportunities, opportunity_wallets, ticker to anon, authenticated;
create policy "public read" on opportunities for select using (true);
create policy "public read" on opportunity_wallets for select using (true);
create policy "public read" on ticker for select using (true);

-- ── opportunities_live ──
-- Direct port of signals-proxy.mjs's /opportunities query: wallet_count and
-- cumulative_usd on `opportunities` are a snapshot frozen at the last tier
-- crossing, so they're computed live from opportunity_wallets instead.
-- total_profit mirrors the drill-down chart's per-trader math: resolved ->
-- exact payout, exited/scalped -> real exit price, still holding ->
-- mark-to-market against the market's current price.
create view opportunities_live with (security_invoker = true) as
  SELECT o.id, o.condition_id, o.outcome, o.slug, o.title, o.tier, o.first_seen, o.last_updated, o.latest_price, o.category,
    COALESCE(w.live_wallet_count, o.wallet_count) AS wallet_count,
    COALESCE(w.live_total_usd, o.cumulative_usd) AS cumulative_usd,
    COALESCE(w.entries, 0) AS entries,
    COALESCE(w.exited, 0) AS exited,
    COALESCE(w.scalped, 0) AS scalped,
    COALESCE(w.closed, 0) AS closed,
    COALESCE(w.won, 0) AS won,
    COALESCE(w.lost, 0) AS lost,
    COALESCE(w.total_profit, 0) AS total_profit
  FROM opportunities o
  INNER JOIN (
    SELECT condition_id, outcome, MAX(tier) AS max_tier
    FROM opportunities GROUP BY condition_id, outcome
  ) m ON o.condition_id = m.condition_id AND o.outcome = m.outcome AND o.tier = m.max_tier
  LEFT JOIN (
    SELECT ow.condition_id, ow.outcome,
      COUNT(*) AS entries,
      COUNT(DISTINCT ow.wallet) AS live_wallet_count,
      SUM(ow.usd) AS live_total_usd,
      SUM(CASE WHEN ow.exit_ts IS NOT NULL THEN 1 ELSE 0 END) AS exited,
      SUM(CASE WHEN ow.is_scalp = true THEN 1 ELSE 0 END) AS scalped,
      SUM(CASE WHEN ow.market_closed = true THEN 1 ELSE 0 END) AS closed,
      SUM(CASE WHEN ow.market_closed = true AND ow.resolved_win = true THEN 1 ELSE 0 END) AS won,
      SUM(CASE WHEN ow.market_closed = true AND ow.resolved_win = false THEN 1 ELSE 0 END) AS lost,
      SUM(
        CASE
          WHEN ow.market_closed = true THEN
            CASE WHEN ow.resolved_win = true THEN (ow.usd / ow.price) - ow.usd ELSE -ow.usd END
          WHEN ow.exit_ts IS NOT NULL AND ow.exit_price IS NOT NULL THEN
            (ow.usd / ow.price) * ow.exit_price - ow.usd
          ELSE
            (ow.usd / ow.price) * COALESCE(lp.cur_price, ow.price) - ow.usd
        END
      ) AS total_profit
    FROM opportunity_wallets ow
    LEFT JOIN (
      SELECT o2.condition_id, o2.outcome, o2.latest_price AS cur_price
      FROM opportunities o2
      INNER JOIN (SELECT condition_id, outcome, MAX(tier) AS max_tier FROM opportunities GROUP BY condition_id, outcome) m2
        ON o2.condition_id = m2.condition_id AND o2.outcome = m2.outcome AND o2.tier = m2.max_tier
    ) lp ON lp.condition_id = ow.condition_id AND lp.outcome = ow.outcome
    GROUP BY ow.condition_id, ow.outcome
  ) w ON o.condition_id = w.condition_id AND o.outcome = w.outcome;

-- ── wallet_positions ──
-- Consolidates three near-duplicate proxy queries (the drill-down wallets
-- list, a trader's resolved positions, and the Profits page's position
-- detail table) into one view, filtered differently per caller.
create view wallet_positions with (security_invoker = true) as
  SELECT ow.condition_id, ow.outcome, ow.wallet, ow.wallet_name, o.title, o.category,
    ow.usd, ow.price, ow.ts, ow.exit_ts, ow.exit_price, ow.exit_usd, ow.hold_seconds,
    ow.is_scalp, ow.market_closed, ow.resolved_win, ow.resolved_ts,
    CASE
      WHEN ow.market_closed = true THEN
        CASE WHEN ow.resolved_win = true THEN (ow.usd / ow.price) - ow.usd ELSE -ow.usd END
      WHEN ow.exit_ts IS NOT NULL AND ow.exit_price IS NOT NULL THEN
        (ow.usd / ow.price) * ow.exit_price - ow.usd
      ELSE
        (ow.usd / ow.price) * COALESCE(lp.cur_price, ow.price) - ow.usd
    END AS profit
  FROM opportunity_wallets ow
  JOIN (SELECT condition_id, outcome, MAX(title) AS title, MAX(category) AS category FROM opportunities GROUP BY condition_id, outcome) o
    ON o.condition_id = ow.condition_id AND o.outcome = ow.outcome
  LEFT JOIN (
    SELECT o2.condition_id, o2.outcome, o2.latest_price AS cur_price
    FROM opportunities o2
    INNER JOIN (SELECT condition_id, outcome, MAX(tier) AS max_tier FROM opportunities GROUP BY condition_id, outcome) m2
      ON o2.condition_id = m2.condition_id AND o2.outcome = m2.outcome AND o2.tier = m2.max_tier
  ) lp ON lp.condition_id = ow.condition_id AND lp.outcome = ow.outcome;

-- ── leaderboard ──
-- Direct port of /leaderboard. Also serves /trader/:wallet's summary
-- (identical query, just filtered to one wallet by the caller).
create view leaderboard with (security_invoker = true) as
  SELECT wallet, MAX(wallet_name) AS wallet_name,
    COUNT(*) AS n,
    SUM(CASE WHEN resolved_win = true THEN 1 ELSE 0 END) AS won,
    SUM(CASE WHEN resolved_win = false THEN 1 ELSE 0 END) AS lost,
    SUM(usd) AS deployed,
    SUM(CASE WHEN resolved_win = true THEN usd ELSE 0 END) AS won_usd,
    SUM(CASE WHEN resolved_win = true THEN (usd / price) - usd ELSE -usd END) AS net_profit
  FROM opportunity_wallets
  WHERE market_closed = true AND wallet IS NOT NULL
  GROUP BY wallet;

-- ── wallet_category_breakdown ──
-- Serves /trader/:wallet's by_category, filtered to one wallet by the caller.
create view wallet_category_breakdown with (security_invoker = true) as
  SELECT ow.wallet, COALESCE(o.category, 'other') AS category,
    COUNT(*) AS n,
    SUM(CASE WHEN ow.resolved_win = true THEN 1 ELSE 0 END) AS won,
    SUM(CASE WHEN ow.resolved_win = false THEN 1 ELSE 0 END) AS lost,
    SUM(CASE WHEN ow.resolved_win = true THEN (ow.usd / ow.price) - ow.usd ELSE -ow.usd END) AS profit
  FROM opportunity_wallets ow
  JOIN (SELECT condition_id, outcome, MAX(category) AS category FROM opportunities GROUP BY condition_id, outcome) o
    ON o.condition_id = ow.condition_id AND o.outcome = ow.outcome
  WHERE ow.market_closed = true
  GROUP BY ow.wallet, o.category;

-- ── profits_summary / profits_daily ──
create view profits_summary with (security_invoker = true) as
  SELECT
    COUNT(*) AS resolved_n,
    SUM(CASE WHEN resolved_win = true THEN 1 ELSE 0 END) AS won,
    SUM(CASE WHEN resolved_win = false THEN 1 ELSE 0 END) AS lost,
    SUM(usd) AS deployed,
    SUM(CASE WHEN resolved_win = true THEN (usd / price) - usd ELSE -usd END) AS net_profit
  FROM opportunity_wallets WHERE market_closed = true;

create view profits_daily with (security_invoker = true) as
  SELECT resolved_ts::date AS d,
    SUM(CASE WHEN resolved_win = true THEN (usd / price) - usd ELSE -usd END) AS day_profit
  FROM opportunity_wallets WHERE market_closed = true
  GROUP BY d;

-- ── app_settings ──
-- Replaces venter_config.json as the source of truth. Public read (everyone
-- sees current config), write restricted to logged-in users only — tighter
-- than the old proxy's /settings POST, which had zero auth at all.
create table app_settings (
  id int primary key default 1,
  roster_size int not null default 500,
  tiers int[] not null default '{1000,5000,20000,50000,100000}',
  ticker_min_usd int not null default 100,
  scalp_window_minutes int not null default 30,
  constraint single_row check (id = 1)
);
insert into app_settings (id) values (1);
alter table app_settings enable row level security;
grant select on app_settings to anon, authenticated;
grant update on app_settings to authenticated;
create policy "public read" on app_settings for select using (true);
create policy "authenticated write" on app_settings for update using (auth.role() = 'authenticated');
