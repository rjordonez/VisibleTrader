"""Offline regression checks: python -m unittest discover -s scripts -p 'test_live_work.py'."""
import importlib.util
from pathlib import Path
import threading
import time
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from live_work import TradeWorkers, SingleFlightJobs, PendingPrices, LaneFullError, PollingJob


def load_service():
    # Never load local production credentials or connect to a database.
    with patch('_env.load_env'):
        spec = importlib.util.spec_from_file_location('live_service_test',
                    Path(__file__).with_name('live-signal-service.py'))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module


class SchedulingTests(unittest.TestCase):
    def test_trade_capacity_and_order(self):
        workers = TradeWorkers(2, 2)
        release = threading.Event()
        entered = threading.Event()
        seen = []
        def first():
            entered.set()
            release.wait(2)
            seen.append('buy')
        try:
            one = workers.submit('token', first)
            self.assertTrue(entered.wait(1))
            two = workers.submit('token', lambda: seen.append('sell'))
            self.assertEqual(workers.available, 0)
            with self.assertRaises(RuntimeError):
                workers.submit('other', lambda: None)
            self.assertEqual(seen, [])
            release.set()
            one.result(2)
            two.result(2)
        finally:
            release.set()
            workers.shutdown()
        self.assertEqual(seen, ['buy', 'sell'])
        self.assertEqual(workers.available, 2)

    def test_blocked_background_does_not_block_trades(self):
        jobs = SingleFlightJobs(1, 'test-background')
        workers = TradeWorkers(1, 1)
        release = threading.Event()
        try:
            self.assertTrue(jobs.submit('slow', release.wait, 2))
            self.assertFalse(jobs.submit('slow', lambda: None))
            self.assertEqual(workers.submit('token', lambda: 42).result(1), 42)
        finally:
            release.set()
            jobs.shutdown()
            workers.shutdown()

    def test_hot_lane_does_not_block_other_lanes(self):
        # A per-lane cap stops one key's backlog from exhausting the whole
        # shared budget and starving unrelated, idle lanes -- the exact
        # failure mode confirmed live on 2026-10-16.
        workers = TradeWorkers(4, 20, max_per_lane=2)
        release = threading.Event()
        try:
            workers.submit('hot', release.wait, 2)
            workers.submit('hot', release.wait, 2)
            with self.assertRaises(LaneFullError):
                workers.submit('hot', release.wait, 2)
            # Plenty of global capacity (18 of 20) remains, but a different
            # key must still go through -- it hashes to its own lane.
            self.assertEqual(workers.submit('cold', lambda: 'ok').result(1), 'ok')
        finally:
            release.set()
            workers.shutdown()

    def test_dispatch_poller_runs_without_socket_loop_and_stops(self):
        dispatched = threading.Event()
        calls = []
        def poll():
            calls.append(1)
            dispatched.set()
        job = PollingJob(poll, interval=0.01)
        job.start()
        try:
            # No WebSocket callback or main-loop tick is supplied.
            self.assertTrue(dispatched.wait(1))
        finally:
            job.stop()
        self.assertFalse(job._thread.is_alive())
        self.assertTrue(calls)

    def test_old_hash_collision_does_not_block_unrelated_market(self):
        import zlib
        hot = 'hot'
        cold = next(str(i) for i in range(100) if zlib.crc32(str(i).encode()) % 2 == zlib.crc32(hot.encode()) % 2)
        workers = TradeWorkers(2, 8, max_per_lane=2)
        release, entered, other = threading.Event(), threading.Event(), threading.Event()
        def blocked():
            entered.set()
            release.wait(3)
        try:
            workers.submit(hot, blocked)
            self.assertTrue(entered.wait(1))
            workers.submit(hot, lambda: None)
            with self.assertRaises(LaneFullError):
                workers.submit(hot, lambda: None)
            workers.submit(cold, other.set)
            self.assertTrue(other.wait(1), 'hash-colliding token must use a free worker')
        finally:
            release.set()
            workers.shutdown()

    def test_many_tokens_preserve_order_and_never_overlap(self):
        workers = TradeWorkers(8, 1000, max_per_lane=100)
        lock = threading.Lock()
        active, seen, overlap = set(), {}, []
        def task(key, sequence):
            import time
            with lock:
                if key in active:
                    overlap.append(key)
                active.add(key)
            time.sleep(.001)
            with lock:
                seen.setdefault(key, []).append(sequence)
                active.remove(key)
        for sequence in range(30):
            for key in range(20):
                workers.submit(key, task, key, sequence)
        workers.shutdown()
        self.assertEqual(overlap, [])
        self.assertEqual(len(seen), 20)
        for sequence in seen.values():
            self.assertEqual(sequence, list(range(30)))
        self.assertEqual(workers.available, 1000)
        with self.assertRaises(RuntimeError):
            workers.submit('after-shutdown', lambda: None)

    def test_failed_and_cancelled_work_does_not_strand_next_fill(self):
        workers = TradeWorkers(1, 8)
        release = threading.Event()
        seen = []
        try:
            first = workers.submit('token', release.wait, 2)
            cancelled = workers.submit('token', seen.append, 'cancelled')
            self.assertTrue(cancelled.cancel())
            failure = workers.submit('token', lambda: 1 / 0)
            last = workers.submit('token', seen.append, 'last')
            release.set()
            first.result(2)
            with self.assertRaises(ZeroDivisionError):
                failure.result(2)
            last.result(2)
            self.assertEqual(seen, ['last'])
        finally:
            release.set()
            workers.shutdown()

    def test_interpreter_exit_drains_queued_fills(self):
        import subprocess, sys
        source = ("from live_work import TradeWorkers; import time; "
                  "w=TradeWorkers(2, 20); "
                  "[w.submit('token', lambda i=i: (time.sleep(.005), print(i))) for i in range(10)]")
        result = subprocess.run([sys.executable, '-c', source],
                                cwd=Path(__file__).parent, capture_output=True,
                                text=True, timeout=5, check=True)
        self.assertEqual(result.stdout.splitlines(), [str(i) for i in range(10)])

    def test_hot_lane_resume_waits_for_half_capacity(self):
        workers = TradeWorkers(1, 8, max_per_lane=4)
        releases = [threading.Event() for _ in range(4)]
        entered = [threading.Event() for _ in range(4)]
        def work(i):
            entered[i].set()
            releases[i].wait(2)
        try:
            for i in range(4):
                workers.submit('hot', work, i)
            self.assertFalse(workers.ready_to_resume('hot'))
            releases[0].set()
            self.assertTrue(entered[1].wait(1))
            self.assertFalse(workers.ready_to_resume('hot'))
            releases[1].set()
            self.assertTrue(entered[2].wait(1))
            self.assertTrue(workers.ready_to_resume('hot'))
        finally:
            for event in releases:
                event.set()
            workers.shutdown()

    def test_failure_releases_capacity(self):
        workers = TradeWorkers(1, 1)
        try:
            future = workers.submit('token', lambda: 1 / 0)
            with self.assertRaises(ZeroDivisionError):
                future.result(1)
        finally:
            workers.shutdown()
        self.assertEqual(workers.available, 1)

    def test_periodic_job_can_run_again_after_failure(self):
        jobs = SingleFlightJobs(1, 'test-failure')
        done = threading.Event()
        def fail():
            try:
                raise RuntimeError('expected failure')
            finally:
                done.set()
        try:
            jobs.submit('refresh', fail)
            self.assertTrue(done.wait(1))
            # Wait for the executor's queued callback to ensure the failed
            # job has completed its finally block, without timing sleeps.
            jobs._executor.submit(lambda: None).result(1)
            self.assertTrue(jobs.submit('refresh', lambda: None))
        finally:
            jobs.shutdown()


class PriceTests(unittest.TestCase):
    def test_latest_quote_and_bounded_batches(self):
        prices = PendingPrices()
        prices.stage([('a', 'yes', .5), ('a', 'yes', .6), ('b', 'no', .4)])
        self.assertEqual(prices.take(1), [('a', 'yes', .6)])
        self.assertEqual(len(prices), 1)

    def test_retry_does_not_replace_newer_quote(self):
        prices = PendingPrices()
        prices.stage([('a', 'yes', .5), ('b', 'no', .4)])
        batch = prices.take(200)
        prices.stage([('a', 'yes', .7)])
        prices.restore(batch)
        self.assertEqual(set(prices.take(200)), {('a', 'yes', .7), ('b', 'no', .4)})

    def test_direct_trade_invalidates_already_taken_quote(self):
        prices = PendingPrices()
        prices.stage([('a', 'yes', .5)])
        batch = prices.take(200)
        prices.discard(('a', 'yes'))
        self.assertEqual(prices.current(batch), [])
        prices.restore(batch)
        self.assertEqual(len(prices), 0)


class ServiceTests(unittest.TestCase):
    def setUp(self):
        self.service = load_service()

    def test_200_quotes_use_one_database_write(self):
        rows = [(f'market-{i}', 'yes', .6) for i in range(200)]
        db = Mock()
        self.service.write_price_updates(db, rows)
        db.execute.assert_called_once()
        sql, params = db.execute.call_args.args
        self.assertIn('IS DISTINCT FROM', sql)
        self.assertEqual(len(params), 600)
        self.assertEqual(len(self.service._dirty_opportunities), 200)

    def test_resolved_quotes_are_not_written(self):
        self.service.pending_prices.stage([('settled', 'yes', .5), ('open', 'no', .4)])
        self.service.resolved_markets.add(('settled', 'yes'))
        db = Mock()
        self.service.flush_pending_prices(db)
        self.assertEqual(db.execute.call_args.args[1], ['open', 'no', .4])

    def test_failed_batch_remains_pending(self):
        self.service.pending_prices.stage([('a', 'yes', .5)])
        db = Mock()
        db.execute.side_effect = RuntimeError('DB unavailable')
        with self.assertRaises(RuntimeError):
            self.service.flush_pending_prices(db)
        self.assertEqual(self.service.pending_prices.take(200), [('a', 'yes', .5)])
        self.assertEqual(len(self.service._dirty_opportunities), 0)

    def test_full_queue_leaves_database_fills_unclaimed(self):
        db = Mock()
        self.service.poll_onchain_fills(db, {}, set(), {}, Mock(available=0))
        db.fetchall.assert_not_called()
        db.execute.assert_not_called()

    def test_dispatch_keeps_fill_values_and_skips_unmonitored_tokens(self):
        timestamp = datetime.now(timezone.utc)
        rows = [
            (1, 'tx-buy', 'maker', 'taker', 0, 'token', 120_000_000, 200_000_000, timestamp),
            (2, 'tx-sell', 'maker', 'taker', 1, 'token', 200_000_000, 120_000_000, timestamp),
            (3, 'ignored', 'maker', 'taker', 0, 'unknown', 120_000_000, 200_000_000, timestamp),
        ]
        db, trade_db = Mock(), Mock()
        db.fetchall.return_value = rows
        workers = Mock(available=3)
        metadata = {'token': {'conditionId': 'market', 'outcome': 'yes'}}
        self.service.poll_onchain_fills(db, metadata, set(), {}, workers, trade_db)
        self.assertEqual(db.fetchall.call_args.args[1], (3,))
        self.assertEqual(workers.submit.call_count, 2)
        buy, sell = [call.args for call in workers.submit.call_args_list]
        self.assertIs(buy[2], trade_db)
        self.assertEqual(buy[4:10], ('token', .6, 200, 'tx-buy', 'maker', 'taker'))
        self.assertEqual(sell[4:10], ('token', .6, 200, 'tx-sell', 'taker', 'maker'))
        self.assertIs(buy[-1], timestamp)
        metadata.clear()
        self.assertIn('token', buy[3])
        db.execute.assert_called_once()
        self.assertEqual(db.execute.call_args.args[1], ([1, 2, 3],))

    def test_database_hot_prefix_does_not_starve_unrelated_token(self):
        # The old worker-only fairness test missed the real failure: the
        # cold token is OUTSIDE the SQL LIMIT, behind 1,000 hot fills.
        service = self.service
        stamp = datetime.now(timezone.utc)
        rows = [(i, str(i), 'buyer', 'seller', 0, 'hot', 1, 1, stamp)
                for i in range(1000)]
        rows.append((1000, 'cold', 'buyer', 'seller', 0, 'cold', 1, 1, stamp))
        pending = {r[0]: r for r in rows}
        def read(sql, params):
            excluded = set(params[0]) if len(params) == 2 else set()
            return [r for r in pending.values() if r[5] not in excluded][:params[-1]]
        def ack(sql, params):
            for row_id in params[0]:
                pending.pop(row_id)
        db = Mock()
        db.fetchall.side_effect = read
        db.execute.side_effect = ack
        workers = TradeWorkers(4, 20, max_per_lane=2)
        release, cold = threading.Event(), threading.Event()
        seen = []
        def process(*args):
            token, tx = args[2], args[5]
            if token == 'hot':
                release.wait(5)
            else:
                cold.set()
            seen.append(tx)
        service.process_fill = process
        admission = service.FillAdmission()
        try:
            metadata = {'hot': {}, 'cold': {}}
            # Tracked buyer: these fills take the lane path this test is about.
            roster = {'buyer'}
            service.poll_onchain_fills(db, metadata, roster, {}, workers, admission=admission)
            service.poll_onchain_fills(db, metadata, roster, {}, workers, admission=admission)
            self.assertTrue(cold.wait(1), 'cold market remains behind the hot SQL prefix')
            self.assertEqual(len(pending), 998)
            self.assertIn(2, pending)  # deferred fills were not discarded
            release.set()
            for _ in range(1000):
                workers.wait_idle()
                if not pending:
                    break
                service.poll_onchain_fills(db, metadata, roster, {}, workers, admission=admission)
            self.assertEqual(pending, {})
        finally:
            release.set()
            workers.shutdown()
        self.assertEqual([x for x in seen if x != 'cold'], [str(i) for i in range(1000)])

    def test_ack_retry_does_not_submit_twice(self):
        service = self.service
        row = (1, 'tx', 'buyer', 'seller', 0, 'token', 1, 1, datetime.now(timezone.utc))
        db, workers = Mock(), Mock(available=5)
        db.fetchall.side_effect = [[row], []]
        db.execute.side_effect = [RuntimeError('connection lost'), None]
        admission = service.FillAdmission()
        with self.assertRaises(RuntimeError):
            service.poll_onchain_fills(db, {'token': {}}, set(), {}, workers, admission=admission)
        self.assertEqual(admission.pending_ack, [1])
        service.poll_onchain_fills(db, {'token': {}}, set(), {}, workers, admission=admission)
        self.assertEqual(workers.submit.call_count, 1)
        self.assertEqual(admission.pending_ack, [])

    def fast_path_poll(self, roster, pending, amount=50_000_000):
        service = self.service
        row = (1, 'tx', 'buyer', 'seller', 0, 'token', amount, 100_000_000, datetime.now(timezone.utc))
        db, workers = Mock(), Mock(available=5)
        workers.pending_for.return_value = pending
        db.fetchall.side_effect = [[row], []]
        service.process_fill = Mock()
        admission = service.FillAdmission()
        service.poll_onchain_fills(db, {'token': {}}, roster, {}, workers, admission=admission)
        return service.process_fill, workers, db

    def test_small_untracked_fill_skips_idle_lane(self):
        fill, workers, db = self.fast_path_poll(set(), pending=0)
        fill.assert_called_once()
        workers.submit.assert_not_called()
        db.execute.assert_called_once()  # acknowledged in the same poll

    def test_tracked_fill_still_uses_lane(self):
        fill, workers, _ = self.fast_path_poll({'buyer'}, pending=0)
        fill.assert_not_called()
        workers.submit.assert_called_once()

    def test_small_fill_waits_behind_busy_lane(self):
        fill, workers, _ = self.fast_path_poll(set(), pending=3)
        fill.assert_not_called()
        workers.submit.assert_called_once()

    def test_ticker_sized_fill_still_uses_lane(self):
        fill, workers, _ = self.fast_path_poll(set(), pending=0, amount=500_000_000)
        fill.assert_not_called()
        workers.submit.assert_called_once()

    def test_rejected_token_cannot_overtake_within_same_batch(self):
        service = self.service
        stamp = datetime.now(timezone.utc)
        rows = [(i, str(i), 'buyer', 'seller', 0, 'token', 1, 1, stamp) for i in range(3)]
        db, workers = Mock(), Mock(available=3)
        db.fetchall.return_value = rows
        # The worker becomes free immediately after rejecting the first row.
        workers.submit.side_effect = [LaneFullError('full'), Mock(), Mock()]
        admission = service.FillAdmission()
        service.poll_onchain_fills(db, {'token': {}}, set(), {}, workers, admission=admission)
        self.assertEqual(workers.submit.call_count, 1)
        db.execute.assert_not_called()

    def test_empty_batch_does_not_write(self):
        db = Mock()
        self.service.flush_pending_prices(db)
        db.execute.assert_not_called()

    def test_fill_preserves_buyer_seller_arguments(self):
        service = self.service
        service.process_trade_timed = Mock()
        db, metadata, roster, names, timestamp = object(), {}, set(), {}, object()
        service.process_fill(db, metadata, 'token', .6, 200, 'tx',
                             'buyer', 'seller', roster, names, timestamp)
        calls = service.process_trade_timed.call_args_list
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0].args, (db, metadata, 'token', .6, 200, 'BUY',
                                      'tx', 'buyer', roster, names, timestamp, True))
        self.assertEqual(calls[1].args[5:8], ('SELL', 'tx', 'seller'))
        self.assertFalse(calls[1].args[-1])

    def test_failed_buyer_still_attempts_seller_and_reports_error(self):
        service = self.service
        service.process_trade_timed = Mock(side_effect=[RuntimeError('failure'), None])
        with self.assertRaises(RuntimeError):
            service.process_fill(None, {}, 'token', .6, 200, 'tx', 'buyer', 'seller', set(), {}, None)
        self.assertEqual(service.process_trade_timed.call_count, 2)
        self.assertEqual(service.stats['trade_side_failures'], 1)


class TradeNoOpTests(unittest.TestCase):
    def setUp(self):
        self.s = load_service()
        self.info = {'conditionId': 'condition', 'outcome': 'Yes', 'slug': 'market',
                     'title': 'Market', 'eventId': 'event'}
        self.conn = Mock()
        self.db = Mock()
        self.db.run_transaction.side_effect = lambda fn: fn(self.conn)
        self.s.fetch_live_profile_name = Mock(return_value='Name')
        self.s.fetch_event_category = Mock(return_value='sports')
        self.ts = datetime.now(timezone.utc)

    def trade(self, *, tracked=False, ticker=False, size=1, price=.5, side='SELL'):
        self.s.process_trade(self.db, {'token': self.info}, 'token', price, size,
                             side, 'tx', 'wallet', {'wallet'} if tracked else set(),
                             {}, self.ts, ticker)

    def test_untracked_seller_never_opens_empty_transaction(self):
        self.trade(size=10000)
        self.db.run_transaction.assert_not_called()
        self.s.fetch_live_profile_name.assert_not_called()

    def test_small_untracked_buyer_without_price_write_is_noop(self):
        self.trade(ticker=True, side='BUY')
        self.db.run_transaction.assert_not_called()
        self.s.fetch_live_profile_name.assert_not_called()

    def test_tracked_seller_still_records_close(self):
        self.s.record_exit = Mock(return_value=None)
        self.s.touch_tracked_wallet = Mock()
        self.trade(tracked=True)
        self.s.record_exit.assert_called_once_with(self.conn, 'condition', 'Yes',
                                                   'wallet', .5, .5, self.ts)
        self.s.touch_tracked_wallet.assert_called_once_with(self.conn, 'wallet')

    def test_large_untracked_buyer_keeps_ticker(self):
        self.s.record_ticker_trade = Mock()
        self.s.update_ticker_wallet = Mock()
        self.trade(ticker=True, side='BUY', size=1000)
        self.s.record_ticker_trade.assert_called_once()
        self.s.update_ticker_wallet.assert_called_once()

    def test_small_untracked_buyer_stages_price_without_transaction(self):
        self.s.tiers_hit[('condition', 'Yes')].add(1000)
        self.s.pending_prices.take(200)
        self.trade(ticker=True, side='BUY')
        self.db.run_transaction.assert_not_called()
        self.s.fetch_live_profile_name.assert_not_called()
        self.assertEqual(self.s.pending_prices.take(200), [('condition', 'Yes', .5)])

    def test_backlog_fill_does_not_move_latest_price(self):
        self.s.tiers_hit[('condition', 'Yes')].add(1000)
        self.s.pending_prices.take(200)
        self.ts = datetime.fromtimestamp(datetime.now(timezone.utc).timestamp() - 3600, timezone.utc)
        self.trade(ticker=True, side='BUY')
        self.db.run_transaction.assert_not_called()
        self.assertEqual(self.s.pending_prices.take(200), [])

    def test_tracked_buy_keeps_contribution(self):
        self.s.record_contribution = Mock()
        self.s.record_tier_crossed = Mock()
        self.s.touch_tracked_wallet = Mock()
        self.trade(tracked=True, ticker=True, side='BUY')
        self.s.record_contribution.assert_called_once()


class BotWalletTests(unittest.TestCase):
    def setUp(self):
        self.s = load_service()
        self.cfg = {'whale_roster_size': 2, 'active_roster_size': 0, 'tiers': [1000],
                    'ticker_min_usd': 100, 'scalp_window_minutes': 30, 'tracked_wallets': set()}
        self.users = [{'wallet': w, 'best_pnl': p, 'recent_rank_seen': False, 'recent_pnl': None}
                      for w, p in (('bot', 200), ('human', 100))]

    def scan(self, rows):
        db = Mock()
        db.fetchall.return_value = rows
        with patch('builtins.print'):
            self.s.refresh_bot_wallets(db)

    def test_bot_rate_wallet_leaves_roster(self):
        self.scan([('BOT', 6892), (self.s.ONCHAIN_EXCHANGES[0], 48729)])
        roster = set()
        self.s.apply_config(self.cfg, roster, self.users)
        self.assertEqual(roster, {'human'})
        self.assertNotIn(self.s.ONCHAIN_EXCHANGES[0], self.s.excluded_bot_wallets())

    def test_hand_tracked_bot_stays(self):
        self.scan([('bot', 6892)])
        self.cfg['tracked_wallets'] = {'bot'}
        roster = set()
        self.s.apply_config(self.cfg, roster, self.users)
        self.assertEqual(roster, {'bot', 'human'})

    def test_exclusion_expires(self):
        self.scan([('bot', 6892)])
        later = time.time() + self.s.BOT_EXCLUSION_SECONDS + 1
        self.assertEqual(self.s.excluded_bot_wallets(later), set())


class RosterCacheTests(unittest.TestCase):
    def test_unchanged_poll_reuses_ranking_but_updates_tracked_wallets(self):
        service = load_service()
        source = [{'wallet': 'whale', 'best_pnl': 100, 'recent_rank_seen': False,
                   'recent_pnl': None}]
        original = service.build_roster
        service.build_roster = Mock(wraps=original)
        selector = service.cached_roster_selector(source)
        roster = set()
        cfg = {'whale_roster_size': 1, 'active_roster_size': 0, 'tiers': [1000],
               'ticker_min_usd': 100, 'scalp_window_minutes': 30, 'tracked_wallets': {'tracked'}}
        service.apply_config(cfg, roster, source, selector)
        self.assertEqual(roster, {'whale', 'tracked'})
        cfg['tracked_wallets'] = {'other'}
        service.apply_config(cfg, roster, source, selector)
        self.assertEqual(roster, {'whale', 'other'})
        service.build_roster.assert_called_once()
        cfg['whale_roster_size'] = 0
        service.apply_config(cfg, roster, source, selector)
        self.assertEqual(roster, {'other'})
        self.assertEqual(service.build_roster.call_count, 2)

    def test_fresh_snapshot_has_fresh_ranking(self):
        service = load_service()
        def user(wallet):
            return {'wallet': wallet, 'best_pnl': 10, 'recent_rank_seen': True,
                    'recent_pnl': 10}
        first = service.cached_roster_selector([user('first')])
        second = service.cached_roster_selector([user('second')])
        self.assertEqual(first(1, 1), {'first'})
        self.assertEqual(second(1, 1), {'second'})
        self.assertIs(first(1, 1), first(1, 1))


class HealthTests(unittest.TestCase):
    def setUp(self):
        self.s = load_service()

    def test_job_status_records_success_and_error(self):
        jobs = SingleFlightJobs(1, 'test')
        try:
            done = threading.Event()
            jobs.submit('good', done.set)
            self.assertTrue(done.wait(1))
            failed = threading.Event()
            def bad():
                failed.set()
                raise ValueError('boom')
            jobs.submit('bad', bad)
            self.assertTrue(failed.wait(1))
            for _ in range(50):
                st = jobs.status()
                if st.get('bad', {}).get('error') and not st['good']['running']:
                    break
                threading.Event().wait(.02)
            self.assertIsNotNone(st['good']['ok'])
            self.assertIn('boom', st['bad']['error_msg'])
            self.assertIsNone(st['bad']['ok'])
        finally:
            jobs.shutdown()

    def report(self, markets, ticker_age, system=None, ping=None):
        db = Mock()
        db.fetchall.return_value = markets
        db.fetchone.return_value = (ticker_age,)
        self.s.system_checks = Mock(return_value=system or {})
        env = {'HEALTHCHECK_PING_URL': ping} if ping else {}
        with patch.dict('os.environ', env, clear=False), \
             patch('builtins.print') as out, \
             patch.object(self.s.urllib.request, 'urlopen') as urlopen:
            for key in ('POSTHOG_PROJECT_TOKEN', 'VITE_POSTHOG_PROJECT_TOKEN'):
                __import__('os').environ.pop(key, None)
            self.s.report_health(db, ())
        self.pinged = urlopen.called
        return [c.args[0] for c in out.call_args_list if c.args and str(c.args[0]).startswith('[health]')][-1]

    def test_outside_outage_is_shown_but_does_not_silence_dead_man(self):
        line = self.report([('tokenA', 2.0, 5)], 3.0,
                           system={'polymarket_data': ('STALE', None), 'website': ('OK', 120)},
                           ping='https://hc-ping.example/abc')
        self.assertIn('status=OK', line)
        self.assertIn('system_status=STALE', line)
        self.assertIn('down_checks=polymarket_data', line)
        self.assertIn('check_website_ms=120', line)
        self.assertTrue(self.pinged)

    def test_stuck_pipeline_withholds_dead_man_ping(self):
        self.report([('tokenA', 58000.0, 113000)], 4.0, ping='https://hc-ping.example/abc')
        self.assertFalse(self.pinged)

    def test_probe_classifies_responses(self):
        response = Mock(status=200)
        response.__enter__ = Mock(return_value=response)
        response.__exit__ = Mock(return_value=False)
        with patch.object(self.s.urllib.request, 'urlopen', return_value=response):
            self.assertEqual(self.s._probe('GET', 'https://x', {}, 400)[0], 'OK')
        error = self.s.urllib.error.HTTPError('https://x', 400, 'bad', {}, None)
        with patch.object(self.s.urllib.request, 'urlopen', side_effect=error):
            self.assertEqual(self.s._probe('OPTIONS', 'https://x', {}, 500)[0], 'OK')
            self.assertEqual(self.s._probe('GET', 'https://x', {}, 400)[0], 'STALE')
        with patch.object(self.s.urllib.request, 'urlopen', side_effect=OSError('down')):
            self.assertEqual(self.s._probe('GET', 'https://x', {}, 400), ('STALE', None))

    def test_one_stuck_market_is_stale_even_when_feed_is_fresh(self):
        line = self.report([('tokenA', 58000.0, 113000), ('tokenB', 3.0, 2)], 4.0)
        self.assertIn('status=STALE', line)
        self.assertIn('stuck_markets=1', line)
        self.assertIn('worst_market_waiting_fills=113000', line)

    def test_healthy_pipeline_is_ok(self):
        line = self.report([('tokenA', 2.0, 5)], 3.0)
        self.assertIn('status=OK', line)


if __name__ == '__main__':
    unittest.main()
