# Database and migrations

## Responsibility and technology

PostgreSQL stores application data, Better Auth records and pg-boss queues. The implementation uses parameterised node-postgres queries and explicit transactions. Numbered SQL migrations have recorded checksums. Better Auth uses its PostgreSQL adapter; pg-boss accepts the existing transaction connection when dispatching the domain outbox.

Module-owned schema definitions follow the [data model](../data-model.md). Generated SQL migrations are reviewed and committed during implementation. Migration execution is an explicit release step, never a web request or routine health check.

## Connections and privileges

Use a validated database URL from deployment secrets, bounded pools and explicit connection/query/statement timeouts. Count web, worker, queue and migration connections against the server limit before adding replicas. Use supported encrypted connections when crossing hosts; the initial isolated Compose network is the proposed deployment boundary.

Runtime roles can operate required application/queue tables. A distinct migration credential owns schema changes. Initialise the pg-boss schema with its supported migration tools and verify whether the selected runtime configuration can operate without DDL privileges. Never assume the queue and ORM share a transaction merely because they use the same database URL.

## Schema rules

- Foreign keys for identities, revisions, catalogue assignments, decisions and ledger links.
- Unique constraints for canonical student identity, submission/revision number, contributor/revision, reward entitlement, idempotency key, access user/lecture and migration source key.
- Check constraints for nonnegative balances, valid enum states, positive file sizes and permitted reward totals.
- `timestamptz` for instants and `date` for exam dates; no dates encoded in free-text fields.
- Indexes on catalogue normalised names, publication/review filters, uploader/time, file hash, access user/lecture/expiry, ledger user/time and audit target/time.
- Explicit deletion behaviour; retain accounting and moderation history through controlled anonymisation rather than blanket cascading deletion.

Balance and ledger writes take the same account lock. Multi-recipient rewards lock accounts in stable ID order to avoid deadlocks. Reward transactions and atomic job enqueue are integration-tested against actual PostgreSQL, including rollback and process interruption cases.

## Changes and recovery

Prefer additive schema changes compatible with the previous release. Backfill large tables in resumable batches before enforcing a new constraint. Migration commands acquire a deployment lock and fail on an unexpected schema version. Do not automatically reverse destructive migrations as a rollback strategy.

Readiness queries test connectivity/schema compatibility without writing tables. Backup and restoration cover auth, application and queue schemas plus the matching file snapshot.

## Acceptance criteria

- A fresh database and an upgraded database reach the same expected schema.
- Auth flows, queue enqueue and domain writes work with the chosen runtime privileges.
- Transaction rollback removes both provisional domain effects and newly enqueued jobs.
- Concurrent access/reward tests hold all unique and balance invariants.
- Backup restoration passes counts, relationships, ledger totals and file-manifest checks.
- Runtime connections and credentials are absent from repository files and error responses.

Dependencies: selected package versions, deployment secrets, and every module's schema contract.
