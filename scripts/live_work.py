"""Bounded scheduling primitives for the live service (no network or DB I/O)."""
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
import threading
import zlib


class LaneFullError(RuntimeError):
    """Raised when the specific lane a key hashes to is at its own cap.

    Distinct from the plain RuntimeError raised when the *global* budget is
    exhausted: callers can catch this one specifically and skip just this
    key, since unrelated lanes may still have room.
    """


class TradeWorkers:
    """FIFO per token, parallel across tokens, bounded across all lanes.

    The caller is the single fill dispatcher. It checks available before
    reading the next batch, leaving excess fills in the database.

    Capacity is enforced two ways: a global ceiling across all lanes (as
    before), and a per-lane ceiling (max_per_lane, default ~2x each lane's
    fair share: 2*capacity/workers). Without the per-lane cap, a single hot
    token -- strictly serial by design, one lane, one worker -- can queue
    enough backlog to consume a large fraction of the shared budget. Since
    admission is gated on that one shared counter, a backed-up hot lane then
    blocks admission for every other token's lane too, even ones sitting
    completely idle. Confirmed live (2026-10-16): a handful of tokens
    accounted for the majority of a sustained ~45-minute feed lag this way.
    The original default here (1/4 of total capacity) turned out too loose
    to matter in practice -- the hottest token measured live was holding
    ~9-11% of the shared budget, well under a 25% cap -- so this caps each
    lane much closer to its fair share instead of only stopping total
    domination.
    """
    def __init__(self, workers, capacity, max_per_lane=None):
        if workers < 1 or capacity < 1:
            raise ValueError('workers and capacity must be positive')
        self._lanes = [ThreadPoolExecutor(max_workers=1, thread_name_prefix=f'trades-{i}')
                       for i in range(workers)]
        self._capacity = capacity
        # Floor of 4 so small capacities (as in the unit tests) don't make
        # the per-lane cap bind before the global one ever would.
        self._max_per_lane = max_per_lane if max_per_lane is not None else max(4, (2 * capacity) // workers)
        self._pending = 0
        self._lane_pending = [0] * workers
        self._lock = threading.Lock()

    @property
    def available(self):
        with self._lock:
            return self._capacity - self._pending

    def submit(self, key, fn, *args):
        lane = zlib.crc32(str(key).encode()) % len(self._lanes)
        with self._lock:
            if self._lane_pending[lane] >= self._max_per_lane:
                raise LaneFullError(f'lane {lane} is full ({self._max_per_lane} pending)')
            if self._pending >= self._capacity:
                raise RuntimeError('trade queue is full')
            self._pending += 1
            self._lane_pending[lane] += 1
        try:
            future = self._lanes[lane].submit(fn, *args)
        except BaseException:
            with self._lock:
                self._pending -= 1
                self._lane_pending[lane] -= 1
            raise
        def finished(result):
            with self._lock:
                self._pending -= 1
                self._lane_pending[lane] -= 1
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
