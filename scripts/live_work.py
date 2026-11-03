"""Bounded scheduling primitives for the live service (no network or DB I/O)."""
from concurrent.futures import ThreadPoolExecutor, Future
from contextlib import contextmanager
import threading
import atexit
import zlib
from collections import deque


class LaneFullError(RuntimeError):
    """The ordered queue for this token has reached its capacity."""


class TradeWorkers:
    """Bounded FIFO per token, with free workers shared across all tokens.

    At most one worker owns a token at a time. After one fill, a token with
    more queued work returns to the end of the ready queue. Unrelated tokens
    never share a serial queue just because their hashes collide.
    """
    def __init__(self, workers, capacity, max_per_lane=None):
        if workers < 1 or capacity < 1:
            raise ValueError('workers and capacity must be positive')
        self._capacity = capacity
        self._max_per_lane = max_per_lane if max_per_lane is not None else max(4, (2 * capacity) // workers)
        self._pending = 0
        self._queues = {}
        self._key_pending = {}
        self._ready = deque()
        self._closing = False
        self._condition = threading.Condition()
        self._threads = [threading.Thread(target=self._work, name=f'trades-{i}', daemon=True)
                         for i in range(workers)]
        for thread in self._threads:
            thread.start()
        atexit.register(self.shutdown)

    @property
    def available(self):
        with self._condition:
            return self._capacity - self._pending

    def ready_to_resume(self, key):
        with self._condition:
            return (not self._closing and self._pending < self._capacity
                    and self._key_pending.get(key, 0) <= self._max_per_lane // 2)

    def submit(self, key, fn, *args):
        with self._condition:
            if self._closing:
                raise RuntimeError('trade workers are shutting down')
            count = self._key_pending.get(key, 0)
            if count >= self._max_per_lane:
                raise LaneFullError(f'token queue is full ({self._max_per_lane} pending)')
            if self._pending >= self._capacity:
                raise RuntimeError('trade queue is full')
            future = Future()
            self._pending += 1
            self._key_pending[key] = count + 1
            if key not in self._queues:
                self._queues[key] = deque()
                self._ready.append(key)
            self._queues[key].append((future, fn, args))
            self._condition.notify()
            return future

    def _work(self):
        while True:
            with self._condition:
                while not self._ready:
                    if self._closing and self._pending == 0:
                        return
                    self._condition.wait()
                key = self._ready.popleft()
                future, fn, args = self._queues[key].popleft()
            result, error = None, None
            running = future.set_running_or_notify_cancel()
            if running:
                try:
                    result = fn(*args)
                except BaseException as exc:
                    error = exc
            with self._condition:
                self._pending -= 1
                self._key_pending[key] -= 1
                if self._queues[key]:
                    self._ready.append(key)
                else:
                    del self._queues[key]
                    del self._key_pending[key]
                self._condition.notify_all()
            if running:
                if error is not None:
                    print(f'[trade-error] {error!r}', flush=True)
                    future.set_exception(error)
                else:
                    future.set_result(result)

    def wait_idle(self):
        with self._condition:
            while self._pending:
                self._condition.wait()

    def shutdown(self):
        with self._condition:
            self._closing = True
            self._condition.notify_all()
        for thread in self._threads:
            thread.join()
        atexit.unregister(self.shutdown)


class PollingJob:
    """One independent poller with explicit shutdown; failures retry its state."""
    def __init__(self, fn, interval=0.1):
        self._stop = threading.Event()
        self._fn = fn
        self._interval = interval
        self._thread = threading.Thread(target=self._run, name='fill-dispatch', daemon=True)

    def _run(self):
        while not self._stop.is_set():
            try:
                self._fn()
            except Exception as exc:
                print(f'[dispatch-error] {exc!r}', flush=True)
                self._stop.wait(1)
            self._stop.wait(self._interval)

    def start(self):
        self._thread.start()

    def stop(self):
        self._stop.set()
        self._thread.join()


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
