# Research requests — local acceptance

Verified 2026-10-06 on `feat/mobile-research-requests`, stacked on the unpublished mobile aging work at `b6961284c95fd3afbae2cf975087a14512233595`. This feature is separate from merged PR #7 and its accepted physical iPhone safe-area release.

## Behavior and boundaries

The Research tab offers research, application documents, interview preparation, or a full package. Owners request, cancel, and requeue blocked work; agent claim/complete controls are absent. Progress shows the backend's actual status, claimant, lease, reason, missing deliverables, and event attribution. Artifact previews require matching job, type and version; document metadata is displayed without downloading private files. Historical filenames are never used to infer resume or cover-letter coverage.

Typed runtime validation follows backend research contract commit `0880bef4f71836651e0f6fff8933c591283f1c19`. The HTTPS API boundary uses existing ephemeral owner authorization and credential isolation. Research writes have a separate encrypted device-only journal with the existing storage protocol. Both journals share a write lock; navigation and other edits remain blocked while a research operation is unresolved. Recovery preserves the exact operation and idempotency key. Logout/session clearing purges both journals. No credentials, provider grants, production configuration, or new native dependencies were created.

The active application summary now says “active applications.” Separate mobile count commit `546cac1` is preserved on `fix/mobile-active-application-count`. The legacy local primary-role exclusion is removed: Applied, Screening, Interview and Offer each count, including linked and waiting/parked records. Regressions verify that the primary relationship stays intact and terminal/missing stages do not count. Live workload totals continue to come from the server. This matches backend count contract `759b9c2806a3c205e61760f6b7e1f35965e95901`.

## Verification

- `npm run check`: vendor verification, TypeScript, ESLint, 125 Jest tests across 18 suites, and four scene-plugin checks passed. Two optional local-backend tests are skipped by default; the research integration test was run separately as described below.
- `EXPO_PUBLIC_TRACKER_MODE=demo npx expo export --platform all --output-dir /tmp/jobintel-research-bundles`: iOS, Android and web production bundle export passed. This is compilation, not installation or publication.
- Opt-in `JOB_INTEL_RESEARCH_CONTRACT_QA=1 npm test -- --runTestsByPath tests/research-local-contract.test.ts`: passed against the isolated synthetic backend on localhost:8005. It verifies request parsing, duplicate protection, missing deliverables, cancellation, stale-version conflicts and exact-key recovery after a lost acknowledgment. Its disposable synthetic job was deleted in `finally`. The fixture uses an inert browser owner session; it does not prove native production authentication.
- Backend `test_native_owner_queue_without_admin_or_agent_authority`: passed independently against the candidate backend. One upstream Starlette/httpx deprecation warning remains.
- Independent review identified a missing durable operation on action-preflight conflicts and an unrelated-request comparison in recovery. Both were fixed with regression coverage; follow-up review found no blockers.

[Actual iOS Simulator capture](ios-research-request.png) contains only bundled synthetic data, rendered in Expo Go on iPhone 16 Pro / iOS 18.5. A temporary initial Research tab was used to reach this view without gesture automation and restored to Overview afterward. Expo Go's floating development control is visible. This verifies rendering, not keyboard gestures, VoiceOver, physical-device behavior, or provider authentication.

Screenshot saved to Library as `libfile_d080e40a27188191a1f65bfe74d25949` (`file_000000004444820eaeaf15b373a65206`). Final independent review found no blockers in the summary label, regression, acceptance notes, screenshot or restored default tab.

## Remaining release dependencies

Backend research routes must be merged and deployed before live client use. Durable backend work-available events do not yet have a configured delivery transport or agent wake-up integration; the app does not promise that requesting work will immediately run an agent. No live queue writes occurred. The newer aging/research client has not been pushed, merged, deployed or installed on a phone. Existing PR #7 approval applies to its already installed safe-area release only. Android execution remains deferred in favor of iOS.
