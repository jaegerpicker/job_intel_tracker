# Owner-only mobile protocol — local implementation, live setup gated

The React Native companion now has a backend/mobile session protocol and live record writes. Production authentication remains disabled by default. This branch creates no provider registrations, credentials, grants, live configuration, deployments or domain association files. Apple and Google use server verification and separately approved stable owner subjects. Email matching and first-login ownership cannot authorize access.

## Protocol

1. The native app generates a 32-byte cryptographically random PKCE verifier and independent client state. It sends only the S256 challenge, state, `provider: apple` or `provider: google`, and exact callback to `POST /auth/mobile/start`. The server requires `MOBILE_AUTH_ENABLED=1`, canonical HTTPS `PUBLIC_BASE_URL`, a configured Apple or Google owner allowlist, and `MOBILE_REDIRECT_URIS` containing only that origin's `/auth/mobile/callback`. Transactions expire after five minutes; an outstanding-flow bound limits storage growth.
2. The app persists the verifier/state/expiry in native secure storage, then opens the returned same-origin `/auth/mobile/authorize` URL in the system authentication browser. An existing browser owner session sees a confirmation form; otherwise the selected Apple or Google state/nonce/cookie/code/signature/subject verification creates a normal browser owner session and returns to that form. This does not copy the browser cookie into the app. The confirmation requires the owner cookie, exact Origin and per-session CSRF value. A GET cannot grant native access.
3. Confirmation redirects a random, one-use 60-second **handoff code**, bound to the original challenge/redirect, and the client's state to the same-origin claimed HTTPS callback. No bearer or provider token appears in the URL. A fallback page ignores all query values and issues no credentials if the native association did not open the app.
4. The app checks the exact callback, rejects duplicate/unexpected parameters and fragments, verifies state and local expiry, then calls `POST /auth/mobile/exchange` with the code/verifier/redirect. The configured SQLite or PostgreSQL backend atomically consumes the code and creates a random `mobile_` bearer session. Only credential/code hashes are stored; a separate five-minute provider continuation record temporarily holds an authorization ticket with no direct bearer authority. Sessions expire after **15 minutes**, with no refresh grant.
5. Every REST access checks the session hash, expiry and revocation. The native owner can read records/material metadata and create/update jobs, notes and interview preparation with owner attribution. Policy/rating writes, cap overrides, agent credential administration, exports, deletion and binary file transfer are refused. Native research requests/actions follow the owner-only queue contract. Browser cookie mutations still require their existing Origin/CSRF checks. The client separately verifies `/api/me` owner identity; agent tokens cannot enable the owner board.

## Native storage and lifecycle

`expo-secure-store` uses platform Keychain/Keystore, with `WHEN_UNLOCKED_THIS_DEVICE_ONLY` on iOS and automatic Android-backup exclusion. Access sessions and pending login state live there, bound to an origin-derived namespace; no AsyncStorage, localStorage, build-variable token, provider ID token or signing key is accepted. Web live mode fails closed. iOS Keychain can survive reinstall; startup always rechecks the 15-minute expiry, and the first board request checks server identity/revocation. Screens cover private content while the app is inactive; screenshots and native app-switcher timing still require device acceptance testing.

Repeated login and callback completion are single flight. Cancelled login clears local verifier state. A terminated app can validate a pending callback after restart; it never invents a session. If exchange committed but its response was lost, the server correctly refuses code replay: start a new login, while the unreachable session expires within 15 minutes. Old session callbacks cannot invalidate a newer login. Expiry/revocation purge in-memory board views and require fresh sign-in.

Logout clears memory immediately, first persists a secure logout marker, removes session/login material and strictly purges pending work, and independently attempts server revocation. Interrupted cleanup resumes on startup; cleanup failure keeps login blocked until retried. Offline revocation is reported as unconfirmed, with authority bounded by the 15-minute server expiry. A process interruption after local erasure and before server revocation has the same expiry bound. Already accepted server writes are not undone by logout.

## Durable writes and conflict review

Before any new live write is sent, `SecureWriteJournal` stores the exact resource ID, body, expected version and idempotency key. Its two-bank chunk/manifest design keeps each encrypted value below 1,800 bytes, verifies the reconstructed digest/origin and limits an operation to 64 KiB of ASCII-escaped JSON. A partially written replacement cannot replace the published manifest. There is one outstanding operation, no automatic background queue.

A new operation compares the current server version after persistence, then uses the existing transactional version/cap/idempotency checks. A retry sends exactly the stored operation: the first response may have been lost after commit, so it cannot substitute a new key or expected version. Client/session generation guards prevent logout from being followed by late repersistence or transmission. Storage failure before persistence prevents transport. An acknowledged operation removes its manifest atomically; leftover encrypted chunks from failed best-effort garbage collection are strictly purged at discard/logout.

Restart or conflict presents the original draft, an explicit retry, and a latest-record comparison. Discard is enabled only after loading that comparison; the user then starts a fresh edit/key. Nothing silently rebases a draft or overrides a cap. Unsaved UI drafts are memory-only and are cleared when private views unmount. Private file transfers remain unimplemented; metadata visibility is not file authority.

## Verified locally

Backend tests use isolated SQLite and PostgreSQL databases, synthetic owner identities and signed mocked Apple/Google token/JWKS responses. Client tests inject synthetic transport, browser, clock, crypto and storage, including response-loss writes, login/replay/logout races, storage interruption, secret redaction and source invalidation. No production provider response or private job/resume data is captured.

## Remaining live acceptance steps

- Review and approve this backend change and enable the native endpoints with the exact canonical-origin callback; both enabled providers require current live acceptance.
- Choose approved iOS bundle/Android application identifiers and signed builds. Set the public API/callback variables; `mobile/app.config.ts` derives the matching associated-domain and exact-path intent filter. Host verified AASA/assetlinks files using actual approved app signing identities. No such identities/files are fabricated here.
- Use signed native builds to exercise real iOS Universal Links/Android App Links and system-browser returns. Expo Go cannot validate the custom application's domain association. Verify interrupted/cancelled login, wrong owner, revocation and expiry on both devices.
- Confirm native Keychain/Keystore failure, device-lock, reinstall, app-switcher privacy, VoiceOver/TalkBack, and process termination after write delivery. Synthetic protocol tests do not certify those OS/provider paths.
- Preserve no-access-log/secret-redacted proxy logging, TLS and request/rate limits described in SECURITY.md. Do not run debug tracing with live authentication.

Google uses the same native approval/session scopes and no email linking. See [Google setup](GOOGLE_SETUP.md). Expo web live mode remains locked; the server web board supports both providers.
