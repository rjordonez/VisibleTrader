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
