create or replace function public.rebuild_trader_scores()
returns integer
language plpgsql
as $function$
declare
  v_max timestamptz;
  v_rows integer;
begin
  perform pg_advisory_xact_lock(hashtext('trader_scores'));
  select max(resolved_ts) into v_max from opportunity_wallets where market_closed;
  perform set_config('enable_indexscan', 'off', true);
  perform set_config('enable_bitmapscan', 'off', true);
  perform set_config('work_mem', '256MB', true);

  delete from trader_market_results;
  insert into trader_market_results
  select p.wallet, p.condition_id, p.outcome, coalesce(o.category, 'other'),
    p.usd, p.shares, p.won, p.first_ts, p.resolved_ts
  from (
    select wallet, condition_id, outcome,
      sum(usd) as usd, sum(usd / price) as shares, bool_or(resolved_win) as won,
      min(ts) as first_ts, max(resolved_ts) as resolved_ts
    from opportunity_wallets
    where market_closed and wallet is not null and resolved_win is not null
      and price > 0 and price < 1 and resolved_ts <= v_max
    group by 1, 2, 3
  ) p
  left join (
    select condition_id, outcome, max(category) as category
    from opportunities where is_current
    group by 1, 2
  ) o on o.condition_id = p.condition_id and o.outcome = p.outcome;

  delete from trader_scores;
  insert into trader_scores (wallet, wallet_name, markets, wins, expected_wins, deployed, pnl,
    edge_pts, z, longshots, longshot_wins, longshot_expected, longshot_pnl, insider_z, is_expert, is_insider)
  select wallet, wallet_name, markets, wins, expected_wins, deployed, pnl,
    edge_pts, z, longshots, longshot_wins, longshot_expected, longshot_pnl, insider_z, is_expert, is_insider
  from trader_scores_compute order by wallet;
  get diagnostics v_rows = row_count;

  insert into trader_scores_refresh_state (id, last_resolved_ts)
  values (true, coalesce(v_max, '-infinity'))
  on conflict (id) do update set last_resolved_ts = excluded.last_resolved_ts;
  return v_rows;
end;
$function$;
