# Verification evidence

All data used in tests/screenshots is synthetic. No live Apple, agent credentials, private job search data, deployment, DNS change or external communication was used.

## Automated checks

Integration coverage includes unauthenticated resources and exports, session CSRF/origin checks, production demo rejection, agent scope/job isolation, author isolation, owner decision fields, revoked/expired credentials, attribution audit, version conflicts, idempotency collisions/retries, attachment allowlist/signature/path sanitization/download authorization, capacity races, employer primary/alternative rules, provenance validation, backup/restore and MCP forwarding errors.

Apple protocol tests generate temporary inert RSA/EC keys: code exchange is mocked but ID token verification is real. Valid token succeeds; wrong issuer/audience/owner-sub/nonce/expiry/signature and state/replay fail. Secure/SameSite=None callback-flow cookie and Secure/HttpOnly session flags are asserted. Live Apple service/account eligibility, actual callback browser policies and production proxy/TLS are untested and must pass the documented live protocol.

Local: pytest, ruff lint/format, mypy, JavaScript syntax compilation and Python sdist/wheel build. Local Docker daemon was unavailable; the GitHub CI workflow builds the Docker image separately. CI results must be read for the exact published commit before declaring image verification.

## Actual browser QA

Used the connected in-app browser against a loopback-only isolated demo:

- Login/empty state; synthetic examples render active/backlog, salary confidence and preserved titles.
- Repeated example loading retains three jobs without duplicates.
- Selected details; a duplicated-controls async race was identified and fixed with generation checks, then reverified.
- Created a note containing `<img src=x onerror=alert(1)>`; displayed as literal text with no execution.
- Began editing a title then cancelled; persisted original title remained.
- Search reduced list to the matching synthetic employer.
- Saved editable structured search policy.
- Changed a recruiter-intro job from Screening to Interview; detail and board changed, timeline preserved both states and attribution.
- Edited a note and verified its version increased; uploaded the same synthetic material twice and verified v1/v2.
- Imported the synthetic example, retried the import and confirmed zero duplicates; authenticated export downloaded successfully; logout returned to the locked login state.
- An initial blob export did not download in the browser; replaced it with a direct authenticated attachment response and verified the download.
- Mobile viewport 390×844: responsive navigation/stats/filters render; page scrollWidth equals viewport width (390), no horizontal overflow. Viewport reset after test.

![Desktop synthetic board](board.jpg)

![Mobile synthetic board](mobile.jpg)

Independent read-only review found a caller-supplied parent scope bypass and missing create-time owner exception protection. Both were fixed and covered by regression tests before publication. This is scoped code review, not a security certification.

Locked production-mode localhost UI verified with no Apple settings: private workspace screen, no demo entry, unavailable Apple setup message; screenshot locked-deployment.png. Enrollment integration tests use inert capability fixtures and ephemeral signing keys, never live Apple credentials.
