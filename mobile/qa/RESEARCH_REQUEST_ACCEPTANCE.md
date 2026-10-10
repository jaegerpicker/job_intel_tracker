# Research request acceptance

Native research requests use the server queue contract and the same short-lived owner session whether the owner signs in with Apple or Google. Database selection stays behind the REST API. The client never grants agent authority or embeds provider secrets.

Automated synthetic checks cover request parsing, duplicate prevention, missing deliverables, cancel/stale-version conflicts, exact-key retry after lost responses, durable interruption recovery and session clearing. Backend parity covers SQLite and PostgreSQL queue transitions, scope isolation, concurrent claims and outbox retries. See [verification evidence](../../docs/QA.md) for current run results.

Before live release, test the current signed build with approved synthetic fixtures: explicit request creation, progress refresh, interrupted action review, conflict handling and logout/expiry. Verify text/keyboard/accessibility behavior on device. Screenshots establish rendering only, not interaction or provider acceptance.

The durable backend outbox has no configured live transport. Requests do not promise immediate agent execution. Real provider, signed-device and deployment acceptance are separate from protocol tests; see [release dependencies](RELEASE_DEPENDENCIES.md). No private owner/device/operational history is required for this public checklist.
