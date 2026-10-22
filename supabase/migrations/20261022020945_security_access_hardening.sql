-- Backend-only state must not be writable through the public Data API.
-- Missing legacy tables are versioned here so dev can exercise prod's paths.
CREATE TABLE IF NOT EXISTS public.paid_subscribers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.live_activity_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  push_token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE table_name text; policy_row record;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'opportunity_aggregate_dirty', 'leaderboard_refresh_state',
    'opportunity_wallet_max_usd', 'wallet_category_breakdown_refresh_state',
    'market_position_state', 'profit_bot_dirty',
    'paid_subscribers', 'live_activity_tokens'
  ] LOOP
    IF to_regclass('public.' || table_name) IS NULL THEN
      RAISE EXCEPTION 'Required backend table missing: %', table_name;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', table_name);
    EXECUTE format('GRANT ALL ON TABLE public.%I TO service_role', table_name);
    FOR policy_row IN SELECT policyname FROM pg_policies
      WHERE schemaname = 'public' AND tablename = table_name
    LOOP
      EXECUTE format('DROP POLICY %I ON public.%I', policy_row.policyname, table_name);
    END LOOP;
  END LOOP;
END $$;

-- Public counts remain available, without granting access to email addresses.
CREATE OR REPLACE FUNCTION public.public_paid_subscriber_count()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$ SELECT count(*)::integer FROM public.paid_subscribers $$;
REVOKE ALL ON FUNCTION public.public_paid_subscriber_count() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_paid_subscriber_count() TO anon, authenticated, service_role;

-- Scrapers use the service role or the database owner, never the public key.
DROP POLICY IF EXISTS "anon can insert creator stats" ON public.creator_stats;
DROP POLICY IF EXISTS "anon can insert tiktok creator stats" ON public.tiktok_creator_stats;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.creator_stats, public.tiktok_creator_stats FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.creator_stats, public.tiktok_creator_stats TO service_role;

-- Pipeline configuration is global, not a subscriber-owned preference.
DROP POLICY IF EXISTS "authenticated write" ON public.app_settings;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.app_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ADD CONSTRAINT app_settings_valid_values CHECK (
  whale_roster_size BETWEEN 0 AND 2000
  AND active_roster_size BETWEEN 0 AND 2000
  AND ticker_min_usd >= 1 AND scalp_window_minutes >= 1
  AND cardinality(tiers) BETWEEN 1 AND 20
  AND array_ndims(tiers) = 1
  AND array_position(tiers, NULL) IS NULL
  AND 0 <= ALL(tiers)
);

-- Pin application function resolution, leaving extension-owned code alone.
DO $$
DECLARE f record;
BEGIN
  FOR f IN
    SELECT p.oid::regprocedure AS signature FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proconfig IS NULL
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.classid = 'pg_proc'::regclass
        AND d.objid = p.oid AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER FUNCTION %s SET search_path = public, pg_temp', f.signature);
  END LOOP;
END $$;
REVOKE EXECUTE ON FUNCTION public.redeem_access_code(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redeem_access_code(text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.refresh_profit_bot_cache(),
  public.refresh_wallet_pnl_hourly(), public.rebuild_wallet_pnl_hourly()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_profit_bot_cache(),
  public.refresh_wallet_pnl_hourly(), public.rebuild_wallet_pnl_hourly() TO service_role;
