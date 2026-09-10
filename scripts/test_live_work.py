"""Offline regression checks: python -m unittest discover -s scripts -p 'test_live_work.py'."""
import importlib.util
from pathlib import Path
import threading
import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from live_work import TradeWorkers, SingleFlightJobs, PendingPrices


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


if __name__ == '__main__':
    unittest.main()
