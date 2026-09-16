-- opportunity_wallets sees heavy write/update churn (2.6M+ rows). The default
-- autovacuum threshold (20% dead rows) let dead-tuple bloat build up over 2+
-- days, which stalled the visibility map and caused tracked_trade_count()
-- (used by the pre-login landing page) to blow past its 3s statement_timeout
-- and return 500s. Lowering the scale factor makes autovacuum run sooner and
-- more often, keeping bloat from accumulating to that point again.
alter table public.opportunity_wallets
  set (autovacuum_vacuum_scale_factor = 0.05);
