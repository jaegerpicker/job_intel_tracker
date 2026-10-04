# Mobile QA — synthetic data only

Verified 2026-10-04 locally with Node 22.17, Expo SDK 57 and iPhone 16 Pro / iOS 18.5 via Expo Go.

- TypeScript and Expo ESLint pass without warnings.
- Jest: 19 tests in 5 suites cover API auth/error mapping and exact-key retry, runtime validation, safe links/file preflight, policy counting, idempotency/conflicts, accessible controls, screen loading/offline recovery, draft preservation, duplicate-write prevention and late-read suppression.
- Expo Doctor: 21/21 checks pass; Expo dependency compatibility check passes.
- iOS native bundle compiled and ran. Device Hub interaction verified detail navigation, keyboard note entry/save/attribution, interview preparation, independent ratings/research/material metadata, stage update/added timeline, return to updated shared board, and synthetic prospect creation.
- Rebased on canonical-origin backend commit `7f2946ac8261e8b2235477d8007f55afdfe2373e`; all 22 backend tests pass (one upstream Starlette/httpx deprecation warning).
- Final iOS, Android and web production bundle export passed (`npx expo export --platform all`). This is local compilation, not a store build or release.
- Independent review found route-state isolation, deep-link loading/error recovery, malformed timeline and overlapping-request risks. Fixed with shared provider/focus-aware back handling, detail loading/retry states, nested validation and generation guards; regression tests added.

`ios-board.png` and `ios-prep.png` are actual simulator captures, not design mockups. They contain only bundled demo data (and a synthetic QA note/status change). Expo Go's development tools affordance may be visible; it is not app production chrome.

Limitations: Android device execution, VoiceOver/TalkBack manual navigation, large Dynamic Type, hardware keyboard and real authentication/file-transfer acceptance remain unverified. Initial Simulator URL opening timed out before boot finished; bootstatus + opening the installed Expo Go app resolved it. Native CUA selection by “Simulator” failed because Xcode exposes this device window through Device Hub; its supported controls worked. No hanging generic screenshot/state polling loop was used.

Dependency audit after compatible updates reports 60 advisories (50 high, 10 moderate) across transitive Expo/Metro/Jest tooling packages; these counts include dependency chains, not 60 independent flaws. Do not claim a clean dependency audit. `npm audit fix --force` proposed incompatible Expo downgrades and was not used. Review current advisories and SDK-compatible updates before shipping a production app; this branch is a local demo milestone, with no publication or deployment.
