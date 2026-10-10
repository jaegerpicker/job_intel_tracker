# Release dependencies

The server supports SQLite or optional PostgreSQL and separately approved Apple/Google identities for one owner. The native client supports both providers through the server browser/PKCE handoff. See [Google setup](../../docs/GOOGLE_SETUP.md), [PostgreSQL setup](../../docs/POSTGRES_SETUP.md) and [device acceptance](../../docs/MOBILE_DEVICE_ACCEPTANCE.md).

Before releasing a build:

- Run backend parity, mobile typecheck/lint/unit tests and applicable CI checks on the final commit.
- Confirm the deployed backend contract matches the client before approved live use.
- Complete provider and signed-device acceptance for the exact build. Google live acceptance and Android device acceptance remain pending.
- Verify platform associations, session lifecycle, privacy, accessibility and interrupted write recovery.
- Configure an approved agent/outbox transport separately if automatic work delivery is required. Creating a research request does not guarantee an agent will run.

No release, deployment, OAuth configuration or device installation is authorized by this document. Historical operator approvals and deployment identifiers are intentionally omitted from public release guidance.
