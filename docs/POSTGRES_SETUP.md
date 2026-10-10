# Optional PostgreSQL

SQLite remains the default: leave `DATABASE_URL` unset. The loopback-only synthetic demo always uses its explicit local SQLite directory, even if a PostgreSQL URL is present. PostgreSQL is optional for real mode; no hosting subscription is required by the app.

```sh
.venv/bin/pip install -e '.[postgres]'
# Set these privately, outside Git; values below are placeholders.
DATABASE_URL=postgresql://<app-role>:<password>@<private-host>:5432/<database>?sslmode=verify-full
DATA_DIR=/path/to/private/new-data
```

Use a dedicated database/schema and a least-privileged role able to create/alter its own tables. Configure certificate trust for `verify-full`; do not disable verification for remote production connections. URL-encode reserved password characters. Treat the entire URL as a secret. Do not put it in shell history, screenshots, logs, client build variables, or documentation. The Docker build accepts `TRACKER_EXTRAS=postgres`; Compose passes `DATABASE_URL` from the operator environment. The default image retains SQLite-only dependencies.

Startup adopts existing unversioned SQLite schemas without rewriting records or credentials, records schema version 1, and creates missing auth/mobile/queue tables atomically. A newer schema version fails closed. PostgreSQL uses text JSON payloads, double-precision timestamps, a sequence for audit IDs and a JSONB expression index for the one-open-request constraint. Use PostgreSQL 14 or newer; local verification used 14.

Both backends serialize decision-making writes: SQLite uses `BEGIN IMMEDIATE`, PostgreSQL uses a transaction advisory lock before reading mutable state. This deliberately preserves capacity, employer-primary, expected-version, idempotency, queue claim and one-use authentication behavior; it is not a high-throughput writer design. Read projections use a transaction snapshot. Connections commit/roll back and close on exit. Other tools must not write directly into these tables or bypass the advisory lock.

## Existing SQLite data

Changing `DATABASE_URL` selects a different database; it does **not** import SQLite data automatically. Keep the service, all agents, and outbox writers stopped for the entire migration. First take and rehearse a private SQLite/upload backup. Never run the following against a live owner directory during development.

With `DATABASE_URL` privately set to a **new empty PostgreSQL target**:

```sh
.venv/bin/python -m job_intel_tracker.migrate \
  --source-dir /path/to/stopped-sqlite-copy \
  --destination-dir /path/to/new-private-data \
  --confirm-stopped-source-and-empty-target
```

The source opens read-only. Before opening the target or creating the destination directory, the migration accepts unversioned legacy or schema version 1 and rejects newer/incompatible version markers. Target emptiness is checked under the writer lock. Records, revisions, audit, agent credential hashes/scopes/revocation, idempotency, attachments, requests, events and delivery state copy in one database transaction, with row-count checks. Uploads copy to the new directory before commit. Browser/mobile sessions and pending OAuth/enrollment capabilities do not migrate; sign in again. Reapply the independently approved provider owner configuration privately. Keep the old database and backup until validation is complete. On a failure or uncertain commit, inspect the new directory/target before retrying; neither is automatically removed. Do not run both copies as active boards.

## Backup and operational limits

The SQLite backup/restore command refuses PostgreSQL configuration. For PostgreSQL, stop all application/agent/outbox writers, take a private `pg_dump` with an appropriately versioned client and copy uploads while stopped. Rehearse `pg_restore` into a new private target and restore uploads together. Before starting a restored target, clear `sessions`, `flows`, `google_flows`, `mobile_flows`, `mobile_sessions`, `mobile_providers`, and `mobile_apple_flows`; revoke restored agent tokens and cancel pending enrollment. Never expose dumps or include connection secrets in commands/output. PostgreSQL backup/restore is an operator procedure, not an automated utility verified by this change.

A private filesystem remains necessary for uploads. One application instance remains the supported deployment: PostgreSQL locking handles concurrent requests but does not provide shared file storage or horizontal-scaling support. `/healthz` checks the selected database, not OAuth readiness.

## Parity checks

```sh
.venv/bin/pip install -e '.[dev,postgres]'
.venv/bin/python -m pytest -q
# TEST_POSTGRES_URL must point only to an isolated disposable test database.
.venv/bin/python -m pytest -q --postgres -k 'not backup'
```

The PostgreSQL fixture creates a random schema per temporary data root and drops only those schemas after each test. It overrides the demo backend only inside tests. SQLite backup tests stay in the default run; PostgreSQL offline migration has its own parity test. Never set `TEST_POSTGRES_URL` to a production database.
