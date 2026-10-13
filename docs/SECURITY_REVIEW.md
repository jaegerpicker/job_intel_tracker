# Scoped security review — 2026-10-13

A separate review pass examined the local preparation commit `7019a89` and the
incremental dependency/asset changes against main baseline `977ed94`. This is a
source and synthetic verification record, not live-provider/device acceptance
or a claim that a second human reviewer approved the release.

## Authentication and data boundaries

The owner enrollment, native session exchange, local Keychain credential helper,
native auth/runtime/HTTP adapter and browser application script are byte-identical
to the main baseline. No real owner subject, grant, token, session or production data
was read or modified. Python owner JWT validation continues to use
PyJWT/cryptography; the vulnerable npm certificate library is a separate tool.

The only server runtime diff is the public AASA identity override. It validates
an explicit non-wildcard team/bundle shape before storage creation, uses JSON
serialization and retains the established identity when unset. It does not set
MOBILE_AUTH_ENABLED, register a provider, change redirects, permit a different
owner, issue a session or relax an authorization/CSRF/canonical-origin check.
Tests verify the original association, explicit fork association, anonymous
record denial, disabled native start and rejection before storage writes for
invalid values. Public signing metadata is not a private key or owner allowlist.

The mobile dependency changes affect a Jest-preset patch and a targeted tooling
YAML caller. Client source, native identifiers and live configuration are
unchanged. Real provider returns, signed links and device session behavior remain
outside this verification. No Node certificate signing/service path is executed.

## Packaging and CI

Web package data and Docker context use public code/HTML/CSS/JS allowlists;
private-prefixed data, signing files and .env files are excluded. A source/wheel
black-box test injects synthetic private documents, key material and a JS note
into a fixture copy and verifies exclusion while retaining the public UI and
project license. Review found one documentation/setup gap: the source archive
excluded the harmless root .env.example alongside private .env files. The final
manifest re-includes that exact reviewed synthetic example, with regression
coverage. Arbitrary secrets in allowed code remain outside filename guarantees.

CI runs with read-only contents permission, immutable action commits, no retained
checkout credential, bounded jobs and no deployment/publishing step. Contributor
code remains executable tooling input even with these safeguards; no secrets are
passed to it and pull_request_target is not used to run it. No workflow ran here.
Docker runtime is unverified because the local daemon is unavailable; no system
service was installed/started or changed to work around that gap.

## Dependency evidence and remaining risk

The final lock has no sprintf-js, legacy argparse or YAML 4.2 instance. The real
NYC caller resolves patched YAML 4.3.2 and loads synthetic fields/anchors/extends.
A clean npm ci and complete local checks validate the lock. The temporary 4.2
candidate's later YAML advisories were caught and removed before commitment.

Two unpatched tooling advisories remain: one braces instance in Jest/Metro glob
handling and one node-forge instance in certificate/CSR verification. Local
synthetic diagnostics confirm their affected behavior; 49 chain entries are not
49 separate flaws. A custom unreviewed cryptographic patch or incompatible
Expo/Jest migration is not presented as a safe fix. Runtime JS inventories are
checked separately; absence there does not clear build/signing tooling/native
libraries. See mobile/qa/DEPENDENCIES.md for exact scope and blockers.

## Metadata, assets and owner review

All six PNG icons byte-match an integrity-verified public Expo template; the
actual tarball MIT notice is retained despite its 0BSD metadata. Font/decoder
notices and provenance are preserved. Seven project-produced captures have Git
introduction and local OCR evidence, but final visual/privacy review remains an
owner gate. No local asset was uploaded for provenance matching.

PUBLIC_METADATA_REVIEW.md lists exact paths, baseline lines and containing
commits for owner device/Library/deployment/approval context, without values.
The forward cleanup is local only; historical public refs/caches/copies remain.
No history rewrite, visibility/security-setting change, push or deployment is
implied. Private vulnerability reporting remains disabled pending an owner
choice of reporting channel.
