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

No account, API key, `.env`, signing credential, paid EAS service, or running server is needed. Demo state lives in memory and resets when the JS runtime restarts. Pull to refresh reads the current demo session; it does not reset it. Only use synthetic text in this demo. The app deliberately has no live login control or production URL default.

## First milestone

- Search actual role titles, companies and lanes; filter all eight stages; active primary-opportunity capacity and base-floor summary.
- Native routes for board, detail and creating a Prospect. Shared board state, focused Android back handling, safe-area layout, keyboard avoidance, 48-point buttons, accessible labels and selected/disabled states.
- Versioned status updates and immutable timeline entries, notes and interview preparation with separate drafts and authorship.
- Separate independent ratings, research provenance and permitted source links; inert attachment metadata. Unknown compensation remains explicitly unknown.
- Loading, empty, offline, permission and conflict states. Failed network writes retain the identical request/key for explicit retry, block further writes and navigation until resolved, and do not automatically retry or overwrite a conflict.

The demo implements create/status/contribution flows. Editing every job field, deleting records, policy administration, uploads/downloads, revision diffs and production sign-in are deliberately outside this first milestone. A filename/size preflight helper is tested, but private native file transfer is not enabled.

## Architecture

`src/app` supplies Expo Router screens. `src/store.tsx` shares records across them and suppresses late reads that would overwrite a committed write. `src/domain.ts` contains server envelope types, runtime response validation, policy counting, field-preserving write preparation and safe URL/file preflight helpers. `src/api.ts` is an injectable HTTPS-only REST adapter with a 15-second timeout, explicit ephemeral authorization headers, no ambient cookies, URL-encoded IDs and sanitized errors. `src/demo.ts` implements the same repository interface with synthetic fixtures, version conflicts, stable idempotency results, cap checks and server-style attribution/timelines. `src/components.tsx` supplies reusable accessible controls. Screen tests exercise actual drafts, retry behavior and recovery, beyond primitive unit tests.

Expo SDK 57 targets React Native 0.86 and React 19.2.3. Expo was chosen because this project has no custom native SDK dependency and benefits from local iOS/Android iteration plus a web preview. Expo Go suffices for this demo; future auth/file modules may require a development build. See [Expo's SDK matrix](https://docs.expo.dev/versions/v57.0.0/) and [project setup](https://docs.expo.dev/get-started/create-a-project/).

The REST contract isolates the client from SQLite versus a possible PostgreSQL implementation. Database portability belongs behind server transactions, especially version/cap checks and idempotency. No migrations or multitenancy are added here.

See [mobile authentication design](../docs/MOBILE_AUTH.md) before wiring `ApiRepository` to real private records. Existing server security rules remain authoritative.

## Verification and evidence

See [QA](qa/README.md). The path-filtered mobile CI workflow runs the same checks and exports a web bundle; it has not run on GitHub because this branch has not been pushed. Dependency advisories are tracked in QA rather than forcing an incompatible Expo downgrade. The backend and web board remain in the repository root.
