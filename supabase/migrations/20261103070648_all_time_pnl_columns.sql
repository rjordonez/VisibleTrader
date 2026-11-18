alter table insider_wallets add column if not exists all_time_pnl numeric;
alter table expert_traders add column if not exists all_time_pnl numeric;
