# Deployment and private backups

Supported: one FastAPI instance with SQLite or optional PostgreSQL and private files on one persistent filesystem. See [PostgreSQL schema, offline migration and backup](POSTGRES_SETUP.md). No paid APIs. Run on an existing private computer or an already-owned small Linux server; Docker Compose is supplied. No hosting signup, spending, DNS change or public server deployment has been performed.

Docker runs as UID 10001 with dropped capabilities. Compose binds port 8000 to loopback; place a configured HTTPS reverse proxy in front only after owner-provider setup and approval. Mount Apple key read-only separately; never build it into the image. `.dockerignore` allowlists only source and package metadata. Protect `.env`, data, credentials and backups outside Git. The Docker daemon was not running in the initial local environment; CI builds the image separately.

A persistent disk is required. Free hosts with ephemeral application filesystems are unsuitable for durable SQLite/uploads. Paid platforms can require minimum fees plus usage: compare their current pricing before any purchase; none is assumed or configured here. For lowest incremental cost, use existing hardware and owner-managed backups.

## Backup and restore

Run using the same OS owner as the service. Destination must be new, private and outside the data directory:

```sh
.venv/bin/python -m job_intel_tracker.backup backup /private/tracker-data /private/backups/tracker-YYYYMMDD
```

The backup utility acquires SQLite's writer lock while a separate read connection backs up the committed database and copies attachments. Do not copy the raw database while writes are running. Encrypt/store backups privately according to your local policy; do not upload to this public repository.

Stop the service, then restore into a **new** directory:

```sh
.venv/bin/python -m job_intel_tracker.backup restore /private/backups/tracker-YYYYMMDD /private/restored-tracker
```

Restore checks database integrity and invalidates sessions/login flows and revokes agent credentials. Point DATA_DIR/volume to the restored directory, verify records and attachment downloads, and deliberately reauthorize new credentials when needed. Keep the previous data directory until verification succeeds. Test backup/restore regularly; test coverage includes record/material consistency.

## Limitations

No horizontal scaling, background scraping, email sending, antivirus scanning or distributed rate limits. API authentication and audit are app-local. Configure proxy rate limits/body limits/timeouts and storage capacity before Internet use. Agent scope lists are explicit; no implicit OAuth agent grants or model-provider identity federation. Minimal MCP bridge compatibility needs validation with each client.
