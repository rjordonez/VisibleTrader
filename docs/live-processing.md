# Live-processing isolation

This branch addresses the shared worker backlog observed on September 9, 2026.
It does not deploy or restart the production service.

## Default resource allocation

| Work | Workers | Reserved database connections |
| --- | ---: | ---: |
| Trades | 24 ordered token lanes | 24 |
| Quote batches | 1 | 1 |
| Opportunity broadcasts | 1 | 1 |
| Chain ingestion and freshness reports | 1 | 2 (also used by the fill dispatcher) |
| Maintenance | 2 | 2 |
| Main loop/configuration | Main thread | 2 |

Total database connections remain 32. Auxiliary HTTP fan-out inside balance and
resolution routines still uses the existing short-lived thread pools; the table
does not represent every OS thread. `--workers` now controls trade lanes only.
`--db-pool-size` controls the total database connection budget, not each pool.
Verify the actual Supabase pooler allowance before increasing that budget.

At most 200 fills are admitted to memory by default (`--trade-queue-size`). The
rest remain `processed=false` in `onchain_fills`. Each admitted fill processes
both buyer and seller, with the original amounts, timestamps, roster matching,
and position calculations. Token lanes preserve admission order for the same
outcome token; they do not repair historical input ordering or reconstruct a
wallet's unobserved history. Unmonitored tokens remain ignored as before.

Quote updates still pass the existing 15-second per-market throttle. Accepted
quotes are coalesced by market and flushed at a one-second scheduling interval,
up to 200 markets in one UPDATE/commit. This can add up to approximately a second
of scheduling latency under healthy load; it is not a sub-second price SLA.
No trade records are coalesced. Current-price consumers (including unrealized
profit and pick eligibility) continue reading `opportunities.latest_price`.
Market locks and pending-quote invalidation protect direct fill and settlement
price writes from older queued quotes. Database/network latency still matters.

Frontend files, Realtime topics, payloads, ticker INSERT delivery, the five-second
opportunity broadcast schedule, and selection formulas are unchanged by this
branch's backend changes. A failed quote batch is retained for retry. Maintenance
and broadcast jobs allow at most one queued/running instance per job name.

## Verification and tuning

Run offline tests:

```sh
.venv/bin/python -m unittest discover -s scripts -p 'test_live_work.py' -v
.venv/bin/python -m py_compile scripts/live_work.py scripts/live-signal-service.py
```

These check scheduling isolation, queue bounds, token ordering, buyer/seller
arguments, failed-job reporting, quote retry/invalidation, and batch SQL shape.
They do not establish real production throughput or validate the SQL against a
running PostgreSQL instance.

Before rollout, exercise against the development database with a representative
recorded workload, including bursts and a slow statistics refresh. Compare
positions, exits, pick eligibility, ticker content, and settled prices with the
baseline. Confirm throughput exceeds incoming work and monitor database waits.

New heartbeat fields:

- `onchain_fills_received_per_s`: newly inserted chain fills, including
  unmonitored tokens. Ingestion can lag the chain; this is not market throughput.
- `trade_tasks_admitted_per_s`: buyer/seller work admitted for monitored tokens.
- `trade_tasks_finished_per_s`: finished attempts, including failures; inspect
  `trade_side_failures` and `[trade-error]` alongside it.
- `executor_in_flight`: outstanding buyer/seller attempts, bounded by twice the
  configured fill capacity during normal operation.
- `pending_price_markets`: pending quote snapshots, excluding a batch in flight.
- `[freshness]`: age of the oldest undispatched fill by ID and newest ticker trade.

A smaller in-memory queue alone is not proof of recovery: work may have moved
into the database. Freshness must improve too. Tune trade lanes separately from
the connection budget; do not assume 50 workers is a verified platform limit.

## Existing recovery constraint

`onchain_fills.processed` still means **dispatched**, not successfully committed.
An admitted fill can be lost on a hard process exit. A failed fill can also have
partially committed changes. Bounding admission reduces exposure but does not
provide exactly-once processing. This branch surfaces failures; it deliberately
does not automatically replay them and risk double-counting contributions/exits.

Do not use the normal restart deployment script while the old production
process still owns its large in-memory backlog. First plan a controlled drain
and verify completion/failures. Do not bulk reset `processed` rows for replay.
If draining is impossible, recovery requires identifying incomplete effects,
not blindly starting a second consumer or replaying all records.

A separate durable-processing change needs per-fill/per-party identities,
transactional completion markers, idempotent writes, and failure/restart tests.
Keep the single service instance assumption until database claims are introduced.

## November 2 queue admission incident

Production sampling found one trade lane busy in all 399 samples while trade
workers overall were idle in 8,188 of 9,576 samples. A bounded database sample
contained 1,126 one-cent fills for a single monitored market, each involving a
roster wallet. Those records cannot be discarded without changing accounting.
The old `ORDER BY id LIMIT available` query repeatedly returned that lane's
rejected rows. The worker-level capacity cap did not make later database rows
reachable, and a WebSocket reconnect also paused dispatch.

The dispatcher now retains rejected token IDs, excludes them from the next
indexed queue read while their lane is above half capacity, then retries their
oldest rows. Waiting for half capacity is necessary: retrying after just one
completion repeatedly brings the same hot prefix back. A rejected token also
stays blocked for the remainder of its batch to prevent overtaking. Memory
capacity, per-lane bounds, and both trade-side accounting calls are unchanged.
One independent poller owns admission and acknowledgement state. An acknowledgement
failure retries that UPDATE before reading more rows rather than submitting the
same non-idempotent work twice. Metadata refresh uses a locked snapshot.

Validation: the regression suite places a cold token behind 1,000 blocked hot
fills, proves it runs before releasing the hot worker, then drains and checks
every hot fill's order. Tests also cover the resume watermark, acknowledgement
failure, and independent poller shutdown. A conservative replay of 20,000 actual
queued token IDs (charging *every* token a fixed 224 ms fill cost, including
unmonitored ones) changed other-market p95 admission from 817 to 407 seconds and
full admission from 893 to 518 seconds. These are simulation results, not live
throughput or recovery guarantees. The exclusion SELECT used the existing
partial index and took 1.525 ms in production EXPLAIN ANALYZE.

This prevents a saturated lane from blocking all other lanes; it does not make
an individual token infinitely fast. Hash-colliding tokens still share a lane.
Monitor both the oldest outstanding fill and the newest ticker age, plus
`[dispatch]` deferred-token/rejection/acknowledgement counters. A fresh ticker
alone does not mean all historical accounting has caught up.

New processes handle SIGTERM/SIGINT by stopping admission, finishing pending
acknowledgements, and draining workers. This does not retroactively give the old
running process a graceful SIGTERM handler. The first rollout must respect the
existing recovery constraint above; do not blindly restart or reset processed
rows. Abrupt process/VM failure still has the pre-existing dispatched-versus-
committed gap. Exactly-once recovery requires a separate transactional identity
for each fill and party, not a blanket replay.
