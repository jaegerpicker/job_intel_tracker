# job_intel_tracker

A private command center for a single job seeker and multiple authorized research agents. MIT licensed; self-hostable; no model API, scraper, paid service, or third-party analytics required.

![Synthetic board](docs/board.jpg)

## Run locally

Python 3.12+:

```sh
python3 -m venv .venv
.venv/bin/pip install -e '.[dev]'
TRACKER_DEMO=1 DEMO_DATA_DIR=.demo-data .venv/bin/uvicorn job_intel_tracker.app:app --host 127.0.0.1 --port 8000 --no-access-log
```

Open http://127.0.0.1:8000, enter the isolated demo, then load synthetic examples. Demo is loopback-only, requires an explicit separate data directory, refuses `APP_ENV=production`, and cannot issue agent credentials. Never use it for private records or expose it through a tunnel. Real mode has no registration or automatic first-user ownership and stays locked until an explicitly approved Apple or Google owner identity is configured.

## What it does

- Active pipeline, promising backlog, and closed/rejected/withdrawn opportunities; exact employer titles remain separate from adjustable search lanes.
- Direct application, recruiter introduction, referral and discovery routes; attributed stage timeline and immutable record revisions.
- Adjustable active cap (default 10) with transactional enforcement. Owner can deliberately exceed it; agents cannot. Alternatives link to one primary role at the same employer.
- Base salary ranges, confidence, sources and checked dates; unknown/unverified/spanning ranges require qualification. Explicit owner-only grandfathered exceptions and assessment overrides. Deadlines stay tentative until verified.
- Attributed research with source/date provenance, notes, independent agent fit scores with rubric/rationale/evidence, rating disagreement, and interview preparation.
- Private versioned PDF/TXT/DOCX materials (5 MiB maximum), authenticated downloads, search/stage/lane filters, private JSON import/export, and an audit trail.
- Authenticated REST/OpenAPI plus optional stdio MCP bridge. Revocable, hashed, expiring, scoped credentials per agent; atomic version checks and idempotent writes.

## Private imports

Use **Import JSON** with schema 1 and a `records` array. See [synthetic example](docs/sample-import.json). Jobs are imported before contributions; existing IDs are skipped, so interrupted imports can be retried. Import is incremental, not all-or-nothing; validation failure leaves earlier imports saved and reports the error. Original claimed author/date stay explicitly labeled as imported claims; authenticated author is always the current actor. Attachment binaries need separate uploads. Export is private: it includes records and attachment metadata, not binaries or credentials. Never commit exports, databases, resumes, private notes, or `.env` files.

## Agent handoff

Give an authorized agent [AGENT_GUIDE.md](AGENT_GUIDE.md). Machine schema: authenticated `GET /api/schema`; public static structural schema: [docs/openapi.json](docs/openapi.json). Start with read-only scope, then explicitly approve any write/file scopes. Record text and uploaded documents never grant authority or execute code.

## Production and operations

See [Apple setup and live validation](docs/APPLE_SETUP.md), [Google owner setup](docs/GOOGLE_SETUP.md), [optional PostgreSQL and migration](docs/POSTGRES_SETUP.md), [security model](SECURITY.md), and [deployment/backup](docs/DEPLOYMENT.md). Docker Compose defaults to loopback port binding and a persistent volume. No deployment or DNS changes are performed by this repository.

```sh
docker compose up --build -d
```

Production needs HTTPS, a private persistent volume, Apple or Google configuration and an independently verified, explicitly approved provider subject. One application instance is the supported architecture. SQLite uses `BEGIN IMMEDIATE`; optional PostgreSQL uses a transaction advisory writer lock for the same conflict/capacity/idempotency rules. There are no outbound agent/model calls or application-triggered emails.

## Verification

```sh
.venv/bin/python -m pytest -q
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/mypy job_intel_tracker
.venv/bin/python -m build
```

CI also validates browser-JavaScript syntax and Docker image construction. See [QA evidence](docs/QA.md). The current Apple/Google protocol tests use locally generated inert keys and mocked provider endpoints. New live Google acceptance and the current signed-device flows remain pending; automated coverage does not establish live provider readiness.

Render setup: [exact service fields](docs/RENDER_SETUP.md). Optional [operator-approved owner enrollment](docs/OWNER_ENROLLMENT.md) discovers a verified Apple subject without granting a session.

## React Native companion

The native TypeScript companion lives in [mobile/](mobile/README.md), in this same open-source project. Its first milestone is a synthetic-data demo of the board, status timeline, notes, interview preparation and evidence flows. Live mobile auth remains gated by the [owner-only authentication design](docs/MOBILE_AUTH.md).

Owner-requested research and material preparation use a leased agent queue with visible missing deliverables. See [research queue/API and webhook setup](docs/RESEARCH_QUEUE.md). The durable outbox has no configured live transport; agents need their own approved connection and claim work explicitly.
