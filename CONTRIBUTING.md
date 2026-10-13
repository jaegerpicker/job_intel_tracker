# Contributing

Use synthetic records and a separate checkout. Never copy a running tracker's
database, exports, resumes, credentials, sessions or signing files into this
repository, an issue, a pull request, a screenshot or a CI artifact. The ignored
paths help prevent accidents; they do not protect files already committed.
Read [SECURITY.md](SECURITY.md) and [fork setup](docs/FORK_SETUP.md).

## Local backend and web checks

Python 3.12+, Git and Node 22 are required for the combined backend/web tests.
The browser regression fixtures execute JavaScript in Node. Install pinned dependencies
in a virtual environment; no account, model API or running service is required.

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-lock.txt
.venv/bin/python -m pytest -q
.venv/bin/ruff check .
.venv/bin/ruff format --check .
.venv/bin/mypy job_intel_tracker
```

Use the README's explicit loopback demo command. `.env.example` documents
synthetic settings; the backend does not automatically read `.env` files.
Leave production/authentication variables absent during local verification.
Use one test process; no real account login or live tracker calls belong in tests.

## Mobile checks

The Python source archive contains the backend and web component. Mobile
development requires a full Git checkout, including `mobile/`.

Read [mobile/AGENTS.md](mobile/AGENTS.md) before editing native code. Use Node 22
and the checked-in npm lockfile. From `mobile`:

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm run check
```

The default is an in-memory synthetic demo. `mobile/.env.example` contains only
public demo configuration; a copied `.env` remains ignored. Jest runs serially.
Do not enable opt-in integration tests against a private or production tracker.
Local checks require no EAS, hosted build, signing account, cloud deployment,
API credits or paid service. Device/signing acceptance is a separate owner task.

## Changes and release review

Include the behavior changed, synthetic verification and remaining limitations.
Preserve attribution and licenses when copying or modifying third-party code.
The vendored URI decoder has an upstream provenance hash verified by
`npm run verify:vendor`. Dependency changes need fresh license and security
review; an npm lockfile license field is an inventory hint, not rights clearance.

The existing workflows use read-only repository permission, immutable action
commits, no persisted checkout credential, job timeouts and cancellation of
superseded runs. No deployment/publishing workflow is configured. Running CI or
publishing changes still requires the applicable repository/owner authorization.
Do not use `pull_request_target` to execute contributor code or expose secrets.

Before any release, complete [the release checklist](docs/RELEASE_READINESS.md).
For a private local history pass, run `scripts/release_preflight.py --help`.
Keep its report outside the repository; findings need local human review.
