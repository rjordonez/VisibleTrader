"""Bounded scheduling primitives for the live service (no network or DB I/O)."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import threading
import zlib


class TradeWorkers:
    """FIFO per token, parallel across tokens, bounded across all lanes.

    The caller is the single fill dispatcher. It checks available before
    reading the next batch, leaving excess fills in the database.
    """
    def __init__(self, workers, capacity):
        if workers < 1 or capacity < 1:
            raise ValueError('workers and capacity must be positive')
        self._lanes = [ThreadPoolExecutor(max_workers=1, thread_name_prefix=f'trades-{i}')
                       for i in range(workers)]
        self._capacity = capacity
        self._pending = 0
        self._lock = threading.Lock()

    @property
    def available(self):
        with self._lock:
            return self._capacity - self._pending

    def submit(self, key, fn, *args):
        with self._lock:
            if self._pending >= self._capacity:
                raise RuntimeError('trade queue is full')
            self._pending += 1
        lane = zlib.crc32(str(key).encode()) % len(self._lanes)
        try:
            future = self._lanes[lane].submit(fn, *args)
        except BaseException:
            with self._lock:
                self._pending -= 1
            raise
        def finished(result):
            with self._lock:
                self._pending -= 1
            if not result.cancelled() and result.exception() is not None:
                print(f'[trade-error] {result.exception()!r}', flush=True)
        future.add_done_callback(finished)
        return future

    def shutdown(self):
        for lane in self._lanes:
            lane.shutdown(wait=True)


class SingleFlightJobs:
    """At most one queued/running instance of each periodic job."""
    def __init__(self, workers, name):
        self._executor = ThreadPoolExecutor(max_workers=workers, thread_name_prefix=name)
        self._active = set()
        self._lock = threading.Lock()

    def submit(self, name, fn, *args):
        with self._lock:
            if name in self._active:
                return False
            self._active.add(name)
        def run():
            try:
                fn(*args)
            except Exception as exc:
                print(f'[job-error] {name}: {exc!r}', flush=True)
            finally:
                with self._lock:
                    self._active.remove(name)
        try:
            self._executor.submit(run)
        except BaseException:
            with self._lock:
                self._active.remove(name)
            raise
        return True

    def shutdown(self):
        self._executor.shutdown(wait=True)


class PendingPrices:
    """Keep the latest pending quote per market, retrying failed batches.

    Callers serialize take/write/restore with direct trade and settlement
    writes. Producers can continue staging quotes during database I/O.
    """
    def __init__(self):
        self._pending = {}
        self._latest = {}
        self._lock = threading.Lock()

    def stage(self, updates):
        with self._lock:
            for condition_id, outcome, price in updates:
                row = (condition_id, outcome, price)
                self._pending[(condition_id, outcome)] = row
                self._latest[(condition_id, outcome)] = row

    def discard(self, key):
        with self._lock:
            self._pending.pop(key, None)
            self._latest.pop(key, None)

    def take(self, limit):
        with self._lock:
            keys = list(self._pending)[:limit]
            return [self._pending.pop(key) for key in keys]

    def current(self, updates):
        with self._lock:
            return [row for row in updates if self._latest.get(row[:2]) is row]

    def restore(self, updates):
        with self._lock:
            for row in updates:
                # A quote arriving during the failed write is newer.
                if self._latest.get(row[:2]) is row:
                    self._pending.setdefault(row[:2], row)

    def acknowledge(self, updates):
        with self._lock:
            for row in updates:
                if self._latest.get(row[:2]) is row:
                    self._latest.pop(row[:2], None)

    def __len__(self):
        with self._lock:
            return len(self._pending)


class MarketLocks:
    """Fixed-size lock stripes: serialize prices per market, not globally."""
    def __init__(self, stripes=256):
        self._locks = [threading.RLock() for _ in range(stripes)]

    @contextmanager
    def hold(self, keys):
        indexes = sorted({zlib.crc32(repr(key).encode()) % len(self._locks) for key in keys})
        for index in indexes:
            self._locks[index].acquire()
        try:
            yield
        finally:
            for index in reversed(indexes):
                self._locks[index].release()
