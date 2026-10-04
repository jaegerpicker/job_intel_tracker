# Mobile QA — synthetic data only

Verified 2026-10-04 locally with Node 22.17, Expo SDK 57 and iPhone 16 Pro / iOS 18.5 via Expo Go.

- TypeScript and Expo ESLint pass without warnings.
- Jest: 32 tests in 7 suites cover API auth/error mapping and exact-key retry, runtime validation, safe links/file preflight, policy counting, idempotency/conflicts, accessible controls, screen loading/offline recovery, draft preservation, duplicate-write prevention and late-read suppression.
- Expo Doctor: 21/21 checks pass; Expo dependency compatibility check passes.
- iOS native bundle compiled and ran. Device Hub interaction verified detail navigation, keyboard note entry/save/attribution, interview preparation, independent ratings/research/material metadata, stage update/added timeline, return to updated shared board, and synthetic prospect creation.
- Rebased on backend commit `3dd4a4583129243fb1142dc56001ea253a0ef949` (canonical origin and enrollment referrer fix); all 22 backend tests pass (one upstream Starlette/httpx deprecation warning).
- Final iOS, Android and web production bundle export passed (`npx expo export --platform all`). This is local compilation, not a store build or release.
- Post-remediation native QA also verified the explicit live-mode lock and a synthetic malformed-query detail deep link using the patched decoder. No production API or credentials were used.
- Independent review found route-state isolation, deep-link loading/error recovery, malformed timeline and overlapping-request risks. Fixed with shared provider/focus-aware back handling, detail loading/retry states, nested validation and generation guards; regression tests added.

`ios-board.png` and `ios-prep.png` are actual simulator captures, not design mockups. They contain only bundled demo data (and a synthetic QA note/status change). Expo Go's development tools affordance may be visible; it is not app production chrome.

Limitations: Android device execution, VoiceOver/TalkBack manual navigation, large Dynamic Type, hardware keyboard and real authentication/file-transfer acceptance remain unverified. Initial Simulator URL opening timed out before boot finished; bootstatus + opening the installed Expo Go app resolved it. Native CUA selection by “Simulator” failed because Xcode exposes this device window through Device Hub; its supported controls worked. No hanging generic screenshot/state polling loop was used.

Post-remediation audit reports 50 high dependency-chain entries from two unpatched tooling advisories, zero moderate/critical. The runtime decoder and UUID paths are fixed, with package, provenance and production-bundle source checks; see [exact exposure and mitigations](DEPENDENCIES.md). Do not claim a clean audit or production authentication readiness. No publication or deployment.

## Owner session/write protocol milestone

The local implementation now includes an opt-in backend PKCE handoff, browser owner confirmation, 15-minute native sessions, Keychain/Keystore storage, logout tombstones and a secure exact-operation journal. Protocol tests use synthetic identities and signed mocked Apple responses. Recovery tests cover response loss after commit, conflicting versions, interrupted secure writes and logout/session races. The foreground/background privacy overlay keeps unsaved native drafts mounted.

Actual iOS Simulator QA opened the live sign-in UI with only `https://example.com` public configuration and verified `Clear local session and work` completed through native SecureStore. No provider sign-in was started. [Native sign-in evidence](ios-owner-signin.png) contains no credentials or private board records. Expo Go does not verify a separately signed application's claimed domains. Real system-browser/provider returns, Android device execution, physical device lock/reinstall/privacy timing and accessibility-reader acceptance remain live setup checks.

See [MOBILE_AUTH](../../docs/MOBILE_AUTH.md) for the exact capability restrictions and pending production configuration. No deployment, provider registration, credential creation or live schema operation occurred.
