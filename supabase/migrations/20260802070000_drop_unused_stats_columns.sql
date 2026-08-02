-- best_win_rate/best_bet_ratio were added to opportunity_stats in the prior
-- migration, but on reflection they don't belong as maintained columns: a
-- contributing wallet's win rate can change from an unrelated market
-- resolving elsewhere, so caching it here would go stale until this
-- specific market got touched again. They stay genuinely live instead —
-- computed at read time in opportunities_live via a small per-market-
-- scoped query (bounded by the new indexes, not a full-table scan), the
-- same "shrink the scan, don't cache the value" approach the plan called
-- for. These columns were never populated or read by anything yet.
alter table opportunity_stats drop column best_win_rate;
alter table opportunity_stats drop column best_bet_ratio;
