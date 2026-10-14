# Release-readiness checkpoint — 2026-10-13

**Source PR #12 was merged by the owner; release decisions remain.**
No merge, visibility/settings change, deployment, live tracker access, credential
revocation or shared-history rewrite was performed by this audit lane. The owner reports that the
automatic third-party integration uses its free plan with no payment added.

## Current merged-main follow-up

The owner merged PR #12 on 2026-10-13 at 4:01:06 PM EDT, producing
`fd65469396800fc1cc432fbe4926a1fc46cd3035`. Current source was fetched and
verified at `92bcae4c1709b2a63e440daa903d1d81504476db`, which also includes
PR #11's optional PostgreSQL backend and explicit Google owner sign-in.
The earlier architecture, dependency and provider evidence below records the
pre-PR-#11 source scope; it does not establish clearance for those additions.

The new PostgreSQL CI job lacked a timeout. This local follow-up gives it the
same 15-minute bound as the existing backend and mobile jobs. All three job
bounds were verified by parsing the workflow YAML. This follow-up is unpublished
and did not start CI or change provider configuration.

Fresh default-backend verification on the merged source: **167 passed, two
skipped in 11.92 seconds**. Google token transport/JWKS are mocked and signing
keys are ephemeral fixtures. Tests used a clean environment with a temporary
data directory; no inherited provider/database settings were used. The two
skips are PostgreSQL migration cases. That default-backend run did not connect
to PostgreSQL. Real OAuth and signed-device acceptance were not attempted.
Ruff check/format and mypy passed. The existing Starlette/httpx deprecation
warning remains.

The subsequent bounded PostgreSQL parity run passed **166 tests, with two
skipped and one deselected, in 25.31 seconds**. It used the existing local
PostgreSQL 14.15 executable with a fresh owned cluster, generated test password,
private Unix socket and TCP listening disabled. Verified cached psycopg 3.2.13
wheels were installed only into a temporary package target; no network package
installation or live database was used. The fixture capped connections and
workers, enforced a 45-second suite budget and stopped the server before
removing its cluster, socket, package target and password. The two skips are
SQLite legacy-adoption/demo-isolation cases; the deselection is the SQLite
backup test. Both PostgreSQL migration cases ran. This covers synthetic
database parity, not production migration, TLS, backup/restore or real OAuth.

Current merged-source mobile verification also passed offline: decoder vendor
provenance, TypeScript, ESLint, **127 serial Jest tests in 15.71 seconds** and
four scene-plugin tests. Two opt-in live-contract tests stayed skipped. The
dependency manifests/lock/vendor tree are unchanged from the earlier verified
preparation, so the check reused those local modules with a clean environment,
no inherited provider settings and a 45-second process budget. The temporary
module link was removed afterward. This adds the explicit Google-provider
handoff regression; it does not replace signed-device/provider acceptance or
claim a fresh production export.

The bounded current-source/history scan at local preparation commit
`0dd995b65bf26f1e2d9bf060c3c9e7c6ef7b45ee` covered **858 objects in 30.22
seconds**, with no truncation. Its 23 candidate records were reviewed locally:
11 URL-credential records are synthetic CI/test values or setup placeholders;
two private-key records are detector fixtures; ten email-address records are
upstream metadata/copyright or synthetic detector fixtures. No live credential
or real job/resume record was confirmed in this scope. All 13 historical binary
objects match the assets reviewed earlier; the scan adds no new pixel or device
acceptance claim. The source authentication follow-up is recorded in
SECURITY_REVIEW.md. Reports and matched values remain outside Git.

Provider acceptance and exact optional PostgreSQL artifacts retain separate
release gates. In particular,
`psycopg[binary]==3.2.13` was outside the original 37-entry base Python-wheel
inventory. A subsequent local review now records exact verified core and
CPython 3.12 macOS ARM64/Linux x86_64 binary wheels, dependency markers and
LGPL-3.0-only metadata in `optional_python_postgres`. The driver license and
artifact hashes are retained under `docs/notices/psycopg/`. Its native client
libraries still need target-specific component notices/source review before
any binary redistribution. The license-inspection phase did not install or
import packages; the later parity phase used temporary targets as described
above.

The new PostgreSQL job's floating action tags and default checkout persistence
are corrected in the local source proposal using the same previously verified
immutable commits and `persist-credentials: false` as the other jobs. Repository
grants/settings were not changed and the proposal has not run on GitHub.
Read-only GitHub checks reconfirmed repository ID 1403668252, public visibility
and default branch `main`. Actions is enabled with `allowed_actions: all`;
default workflow permissions are `read`, and workflows cannot approve pull
requests. This is the observed policy, not a settings change. The checked-in
workflows explicitly use the narrower read-only permissions and pinned actions.
The Python source manifest also includes the new provider/database setup docs
and optional-driver evidence so archive readers retain the linked information.

## Verified source and architecture

GitHub directly reported `jaegerpicker/job_intel_tracker`, repository ID
1403668252, default branch `main`, **already public**. Source baseline:
`977ed94f0c7fc87d5172718097ea74b5951d6b2f`. Work is isolated on
`codex/release-readiness-2026-10-13` in a new local clone. Existing project
checkouts and edits are untouched.

This is one repository: FastAPI/SQLite, private uploads, static browser UI and
optional stdio MCP at the root; Fieldnotes Expo/React Native client in `mobile/`.
The mobile AGENTS.md was read; no repository `.agents/skills` exists. The live
deployment revision is unverified because no Render/live-service call was made.
The owner's existing Apple authentication and private records were untouched.

## Completed checks and improvements

- [x] Initial bounded scan covered all 708 Git objects reachable from the
  fetched local branch/tag refs plus index (68 commits), without truncation.
  Text candidates were inert URL credentials and upstream copyright/package
  metadata. No confirmed live credentials or real job/resume records were found
  in the reviewed inventory. Prepared unit fixtures also contain inert test
  signatures; findings always require local review, never value reproduction.
  Final staged pass covered **742 objects in 26.29 seconds**, with no truncation;
  all historical binary objects match the 13 locally reviewed current assets.
- [x] Local OCR reviewed all 13 binary image assets, without transmitting their
  text. Seven captures: six have synthetic/demo markers; one is unconfigured
  owner sign-in. Six icons have no recognized text. No email address was found. All seven captures were also inspected directly:
  synthetic content or locked/signed-out UI only; no real account, credential,
  job or resume content observed. Historical UI limitations are dated evidence.
- [x] Added a bounded, read-only history/index audit with private reports,
  disabled Git transports/hooks, ambient-Git isolation, limits and synthetic
  regression coverage. Keep reports outside Git; paths may be private.
- [x] Replaced unnecessary Library/device/account workflow breadcrumbs in the
  proposed documentation with general setup and acceptance guidance; public
  domain examples use reserved examples. Existing history was preserved.
- [x] Added contributor/fork documentation, synthetic `.env.example` files,
  broader private-file ignores, explicit MIT package metadata and a pinned build
  backend. Packaging/Docker contexts allow public source types; a black-box
  fixture checks source/wheel privacy and retention of the public UI/license.
- [x] Added optional `MOBILE_APP_ID` for a fork's public AASA identity. The
  established identity is still the default, and only the exact native callback
  is claimed. Invalid values fail before storage creation. Tests preserve
  anonymous denial and disabled native-login boundaries.
- [x] Inventoried 37 Python and 1084 npm lock entries. Retained Expo/decoder
  notices and added the bundled Material Symbols wrapper/font notices with
  provenance. All six PNG icons byte-match the verified official SDK 57 template;
  its actual MIT notice is retained despite 0BSD registry metadata. See
  ASSET_PROVENANCE.json for all icons, captures and generated-asset origins.
- [x] CI configuration uses verified immutable action commits, read-only
  permissions, no persisted checkout credential, timeouts and superseded-run
  cancellation. YAML was checked locally. The authorized push/PR triggered the
  existing standard-runner workflows; backend tests, package builds and Docker
  runtime checks passed. The original mobile run failed on newly recommended
  online Expo catalog versions; both workflows passed on the approved CI
  follow-up. See below.

## Verification evidence

Backend/web: **131 tests passed in 10.81 seconds**, including the final audit and
source/wheel privacy regressions. Ruff check and format and mypy passed. One
existing Starlette/httpx deprecation warning remains.

Mobile: vendor provenance, TypeScript and ESLint passed; 126 serial Jest tests
and four scene-plugin tests passed. Two opt-in live-contract tests were skipped.
Cold single-worker export reached its 45-second budget and its process group
was stopped. A bounded warm-cache retry completed Android/iOS/web export and
runtime inventory checks: patched decoder present, braces/node-forge/uuid/
sprintf-js absent from those runtime JavaScript source inventories. Source-map
source entries have no absolute `/Users/` paths. This does not certify native,
tooling or signed-device safety.

The dependency-remediation increment also completed all three fresh production
exports within one 45-second single-worker budget after the clean install;
runtime inventories passed again. The NYC loader regression verifies the actual
patched YAML 4.3.2 resolution and supported configuration/extends behavior.

Python source and wheel builds passed locally. No Docker daemon is available,
but the authorized PR's existing GitHub CI successfully exercised the modified
image context, root-owned disk, runtime privileges, PORT and restart. No signed native
build, device installation or provider acceptance was attempted.

### Published CI follow-up and review corrections

[PR #12](https://github.com/jaegerpicker/job_intel_tracker/pull/12) includes the
approved CI follow-up `5c7a7edf7e2ce47a81f588187626f98825deb7f9`.
The original mobile run passed `npm run check`, but Expo's online catalog recommends
Expo 57.0.28, expo-crypto 57.0.4 and expo-router 57.0.26. The lockfile retains
the locally tested versions; this is a catalog drift failure, not a failed app
test or a newly established vulnerability finding.

The follow-up sets `EXPO_OFFLINE=1` and `EXPO_NO_TELEMETRY=1` for mobile
CI. The actual installed SDK CLI uses its packaged `bundledNativeModules.json`
for version checks in this mode. This keeps compatibility validation tied to
the lockfile. It does **not** check the newest upstream patch recommendations
or replace a vulnerability audit. Expo emits its offline-validation warning;
do not suppress it or claim current remote-catalog freshness. Before a release,
review upstream patch changes and update/retest the lockfile deliberately.
See [Expo CLI environment variables](https://docs.expo.dev/more/expo-cli/#environment-variables).

Follow-up verification: the actual offline CLI accepts the locked packages
and rejects a disposable synthetic installed expo-crypto 0.0.0 with exit 1.
With the new CI environment, vendor checks, TypeScript, ESLint, all 126 Jest
tests (11.256 seconds) and all four scene-plugin tests pass; the same two live
tests remain skipped. Workflow YAML parses and retains the 15-minute job bound.
GitHub's existing mobile and backend/Docker workflows both passed on this commit,
including all three mobile exports and bundle-inventory checks.

Review identified two valid source-release issues. A synthetic 40 KB `.A` run
without an email address exceeded a two-second external process bound in the
original regex. The corrected pattern starts only at the beginning of a local
part, preventing repeated suffix searches; the audit also checks its deadline
before each pattern. A full CLI no-match regression uses an 800 KB synthetic
run with an external five-second timeout and a four-second audit budget.
The source manifest now includes `requirements-lock.txt`, the linked security
policy and synthetic import sample. The isolated archive test verifies the
lockfile's exact contents and linked-file retention alongside private-file
exclusion. The contributor guide distinguishes this Python source archive
from the full mobile Git checkout. All 132 backend/web tests passed in 10.84
seconds; Ruff check/format and mypy passed.

The existing Greptile integration started automatically when the PR opened.
The owner subsequently reported its free plan and absence of a payment method
and approved the follow-up push. No invoice or billing telemetry was inspected;
no direct Greptile request or settings change was made by this lane.

Final npm audit: **49 high, 0 moderate, 0 critical** dependency-chain entries
from **two distinct advisories/two installed instances** (braces and node-forge).
The formatter path is removed by the tested YAML 4.3.2 caller override; a
compatible SDK 57 Jest-preset patch is included. Tooling exposure remains;
no compatibility-breaking forced SDK/Jest change was applied. See
`mobile/qa/DEPENDENCIES.md` and THIRD_PARTY_NOTICES.md for scope and mitigations.
Fresh auth/packaging review: SECURITY_REVIEW.md. Exact owner-metadata paths,
baseline lines, commit scope and minimal forward/history plan:
PUBLIC_METADATA_REVIEW.md. Identifier values are omitted.

## Owner decisions and remaining release gates

- [ ] Review the exact proposed tree and confirm screenshot visual/privacy content,
  synthetic-only visual content and intended public signing metadata.
- [ ] Choose whether to retain reviewed historical operator context or produce
  a reviewed clean release export. Local removals do not erase already-public
  history; no destructive rewrite or visibility change is authorized here.
- [ ] Resolve the two unpatched tooling advisories or explicitly accept their
  documented exposure for the intended release process. Review exact bundled
  native/data/font artifacts and required notices before distributing binaries.
- [ ] Choose the exact PostgreSQL distribution targets, if any, and retain
  their component notices and applicable source/relinking arrangements. The
  optional-wheel inventory and local parity pass do not clear redistribution.
- [ ] Complete owner-approved real-provider and signed-device acceptance for
  the merged Google/native login paths; synthetic source tests do not establish
  production configuration, accessibility, session recovery or live writes.
- [ ] Enable private vulnerability reporting or provide a private maintainer
  contact. A read-only GitHub check found private reporting **disabled**.
- [ ] Review the existing Actions allow-all policy for the intended contributor
  process. Current workflow pinning does not restrict actions in future workflow
  edits; changing repository policy requires a separate owner decision.
- [x] Exercise the revised Docker image: the existing PR CI passed its runtime,
  root-owned disk, privileges, PORT and restart checks. Local Docker remains
  unavailable. Signed-device/accessibility/session/live-write acceptance remains
  separate, using owner-approved disposable fixtures where needed.
- [x] Owner authorized the sanitized source branch push and PR on 2026-10-13.
- [ ] Independently authorize any merge, package distribution, hosting,
  deployment, signing or changes to the owner's instance.

The scan excludes ignored/untracked and unstaged files, dangling/force-deleted
remote objects, GitHub PR-only refs, reflogs, submodules, LFS payloads, encoded
secrets and semantic/visual personal-data guarantees. OCR and heuristic matches
are evidence within their scope, not public-release clearance.
