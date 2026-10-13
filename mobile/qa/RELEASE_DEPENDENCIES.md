# Release dependencies

The server supports SQLite or optional PostgreSQL and separately approved Apple/Google identities for one owner. The native client supports both providers through the server browser/PKCE handoff. See [Google setup](../../docs/GOOGLE_SETUP.md), [PostgreSQL setup](../../docs/POSTGRES_SETUP.md) and [device acceptance](../../docs/MOBILE_DEVICE_ACCEPTANCE.md).

Before releasing a build:

- Run backend parity, mobile typecheck/lint/unit tests and applicable CI checks on the final commit.
- Confirm the deployed backend contract matches the client before approved live use.
- Complete provider and signed-device acceptance for the exact build. Google live acceptance and Android device acceptance remain pending.
- Verify platform associations, session lifecycle, privacy, accessibility and interrupted write recovery.
- Configure an approved agent/outbox transport separately if automatic work delivery is required. Creating a research request does not guarantee an agent will run.

No release, deployment, OAuth configuration or device installation is authorized by this document. Historical operator approvals and deployment identifiers are intentionally omitted from public release guidance.
# Release dependencies and verification boundaries

The web/backend and Fieldnotes companion share one repository. Integrate mobile
changes with the reviewed main-branch API contract before building a release.
Use a separate local checkout, preserve concurrent edits and record the exact
candidate revision privately. A local branch or passing test does not establish
publication, deployment, signing or installation approval.

## Contract checks

`tests/workload-local-contract.test.ts` and
`tests/research-local-contract.test.ts` are opt-in synthetic integration checks.
They are skipped during ordinary Jest verification. Only enable them with the
corresponding explicitly isolated synthetic fixture. Never point them at a
private board or treat the owner's browser session as a test credential.

The normal tests cover owner identity boundaries, server envelope validation,
record versions, complete-body writes, exact-key lost-acknowledgement recovery,
conflicts and research queue views. Native storage and claimed-link provider
returns have their own protocol and target-device acceptance requirements.

## Release order

1. Review the exact combined candidate, backend/mobile contract and dependency
   inventory. Keep backend/web/mobile local checks green using synthetic data.
2. Obtain any separately required publication/merge authority. Do not publish
   an unapproved dependency indirectly through another feature branch.
3. Have the owner authorize and verify any backend deployment and native signing,
   association configuration or device installation as distinct actions.
4. Complete native device acceptance in `../../docs/MOBILE_DEVICE_ACCEPTANCE.md`.
   Tests do not prove keyboard, accessibility, background privacy, session expiry,
   real provider login or physical live-write behavior.
5. Keep operator-specific developer/device identifiers, Library file identities,
   approval transcripts, local paths and install/deploy records outside source.

Read `DEPENDENCIES.md` for the dated dependency-security snapshot and
`../../docs/RELEASE_READINESS.md` for current release-preparation findings.
No historical approval recorded in a document authorizes a new action.
