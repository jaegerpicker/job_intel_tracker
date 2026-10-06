# Fieldnotes — Job Intel mobile

An Expo / React Native TypeScript companion to the single-owner Job Intel board. This is part of the same MIT-licensed open-source project as the FastAPI server and web board. Native controls and navigation, not a WebView. All bundled records, employers, ratings, materials, and screenshots are synthetic.

## Run locally

Node 22.13+ and npm are required (verified with Node 22.17).

```sh
cd mobile
npm ci
npm run ios       # installed iOS Simulator + Expo Go
npm run android   # Android emulator or connected device + Expo Go
npm run web       # browser preview
npm run check     # TypeScript, ESLint, Jest
npx expo-doctor
npx expo export --platform web
```

No account, API key, `.env`, signing credential, paid EAS service, or running server is needed. Demo state lives in memory and resets when the JS runtime restarts. Pull to refresh reads the current demo session; it does not reset it. Only use synthetic text in this demo. Demo mode has no login control or production URL default. Explicit live mode provides the separately configured owner flow. Dev commands bind localhost. Physical-device access requires separately chosen trusted local connectivity; emulator/simulator is the tested path.

## First milestone

- Search actual role titles, companies and lanes; filter all eight stages; active application capacity and base-floor summary. Linked company roles each count separately.
- Native routes for board, detail and creating a Prospect. Shared board state, focused Android back handling, safe-area layout, keyboard avoidance, 48-point buttons, accessible labels and selected/disabled states.
- Versioned status updates and immutable timeline entries, notes and interview preparation with separate drafts and authorship.
- Separate independent ratings, research provenance and permitted source links; inert attachment metadata. Unknown compensation remains explicitly unknown.
- Loading, empty, offline, permission and conflict states. Failed network writes retain the identical request/key for explicit retry, block further writes and navigation until resolved, and do not automatically retry or overwrite a conflict.

The demo implements create/status/contribution flows. Editing every job field, deleting records, policy administration, uploads/downloads, revision diffs and actual production provider acceptance remain outside the verified demo milestone. A filename/size preflight helper is tested, but private native file transfer is not enabled.

## Architecture

The Research tab lets the owner request research, tailored application documents, interview preparation or a full package; inspect queue progress and available artifact previews; cancel open work; and requeue blocked work. The client never claims or completes work as an agent. Research edits use a separate secure journal and exact-key recovery through the existing owner session. Demo fixtures include queued, blocked and completed requests. See [research-request acceptance and release dependencies](qa/RESEARCH_REQUEST_ACCEPTANCE.md).

`src/app` supplies Expo Router screens. `src/store.tsx` shares records across them and suppresses late reads that would overwrite a committed write. `src/domain.ts` contains server envelope types, runtime response validation, policy counting, field-preserving write preparation and safe URL/file preflight helpers. `src/runtime.ts` selects explicit demo/live mode and wraps live reads/writes in an owner-identity boundary with a secure operation journal; `src/api.ts` is an injectable HTTPS-only REST adapter with a 15-second timeout, explicit ephemeral authorization headers, no ambient cookies, URL-encoded IDs and sanitized errors. `src/demo.ts` implements the same repository interface with synthetic fixtures, version conflicts, stable idempotency results, cap checks and server-style attribution/timelines. `src/components.tsx` supplies reusable accessible controls. Screen tests exercise actual drafts, retry behavior and recovery, beyond primitive unit tests.

Expo SDK 57 targets React Native 0.86 and React 19.2.3. Expo was chosen because this project has no custom native SDK dependency and benefits from local iOS/Android iteration plus a web preview. Expo Go supports the demo and native secure-storage UI checks; real claimed-link authentication requires a signed development or production build. See [Expo's SDK matrix](https://docs.expo.dev/versions/v57.0.0/) and [project setup](https://docs.expo.dev/get-started/create-a-project/).

The REST contract isolates the client from SQLite versus a possible PostgreSQL implementation. Database portability belongs behind server transactions, especially version/cap checks and idempotency. No migrations or multitenancy are added here.

## Explicit demo and live modes

No configuration defaults to synthetic demo. `EXPO_PUBLIC_TRACKER_MODE=demo` explicitly selects the same mode. For a local locked-mode check:

```sh
EXPO_PUBLIC_TRACKER_MODE=live EXPO_PUBLIC_TRACKER_API_ORIGIN=https://example.com npm run ios
```

The public origin is configuration, not a credential. Explicit live mode never falls back to demo; unknown mode or missing live origin/callback remains locked. Live mode with complete public configuration initializes native secure storage and shows owner sign-in; restoration alone makes no API request unless a valid session is restored. Never put tokens or Apple/Google secrets in any `EXPO_PUBLIC_*` variable.

The local backend implements the disabled-by-default PKCE native owner session exchange. The client checks origin/15-minute expiry, verifies owner identity before records/material metadata and writes, rejects agent identities, and invalidates on expiry/401/403. A device-only secure journal must persist every live edit before transport. Pending delivery and conflicts require explicit recovery; private binary files and policy/agent administration remain refused. See [the mobile protocol and live setup dependencies](../docs/MOBILE_AUTH.md).

## Verification and evidence

See [QA](qa/README.md). The path-filtered mobile CI workflow runs the same checks and exports all three platform bundles; the PR checks report verification for the current published commit. Dependency remediation and actual remaining tooling exposure are tracked in [QA/dependencies](qa/DEPENDENCIES.md); the runtime decoder is patched without downgrading Expo. The backend and web board remain in the repository root.

## Native owner session milestone

The local branch now implements the disabled-by-default PKCE browser handoff, 15-minute owner bearer sessions and secure durable live record writes. `EXPO_PUBLIC_TRACKER_MODE=live`, `EXPO_PUBLIC_TRACKER_API_ORIGIN`, and `EXPO_PUBLIC_TRACKER_MOBILE_REDIRECT` are public configuration only; the callback must equal the API origin plus `/auth/mobile/callback`. Missing configuration remains locked and live never falls back to synthetic demo. Google, private binary files and native policy administration remain gated.

Read [the complete mobile protocol and remaining setup](../docs/MOBILE_AUTH.md) before enabling anything. No real provider configuration, signing identity, association hosting or deployment is performed by the demo commands. `npm run check` covers native storage boundaries, login/logout interruption, exact journal retries and conflict review; `npm run verify:bundles` checks exported dependencies. Expo Go can exercise UI and secure-storage availability but cannot certify your signed application's claimed links.
