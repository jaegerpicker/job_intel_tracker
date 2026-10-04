# First owner-device acceptance

Updated October 4, 2026. The approved deployment, signed physical iPhone installation, and Apple provider return to the board are complete. The sections below retain preparation history; the verified result at the end supersedes earlier pending or unavailable states.

## Initial local prerequisites (before dedicated provisioning)

- Xcode 27.0 (27A266a), CocoaPods, Node 22.17.0 are installed.
- One valid Apple Development signing identity exists. No key was exported.
- The installed wildcard development profile reports team and application prefix
  `VHWFV2V25Z`, expiry September 30, 2027, and seven registered devices.
  It has no Associated Domains entitlement and cannot prove suitability for this app.
- The detected physical iPhone 17 Pro Max, “Tome of truth”, is currently unavailable.
  Connect, unlock, trust this Mac, and enable Developer Mode before installation.
- iPhone 16 Pro simulator is connected. Simulator QA does not verify physical
  provisioning, production universal links, or secure-storage behavior on a phone.

## Proposed identifiers and public configuration

Reuse the dedicated identifier `com.sandkcampbell.jobinteltracker` for iOS and
propose the same Android package. The dedicated App ID detail page was independently inspected in Apple Developer:
its App ID prefix is `VHWFV2V25Z`. Associated Domains was enabled with owner
approval; Sign in with Apple remains enabled as primary. No certificate or key
was created. This verification is independent of the wildcard profile metadata.

Build configuration:

```sh
EXPO_PUBLIC_TRACKER_MODE=live
EXPO_PUBLIC_TRACKER_API_ORIGIN=https://jobs.sandkcampbell.com
EXPO_PUBLIC_TRACKER_MOBILE_REDIRECT=https://jobs.sandkcampbell.com/auth/mobile/callback
```

The existing config derives `applinks:jobs.sandkcampbell.com` from these values.
The installed Expo WebBrowser implementation supports an HTTPS authentication
callback on iOS 17.4 or newer. Use the detected modern iPhone for this milestone;
the Expo build-properties plugin enforces iOS 17.4 as the minimum deployment target.

The adjacent AASA artifact uses the now-verified dedicated App ID prefix. Serve the verified file
at `/.well-known/apple-app-site-association` with JSON content type, HTTPS, and no
redirect. Permit only `/auth/mobile/callback`. Do not create an Android assetlinks
file until the actual approved Android signing certificate fingerprint is known.

## Approval bundle

The owner approved these concrete actions; execute after validation and coordination:

1. Set the iOS bundle identifier and Android package above in Expo configuration.
   Verify the dedicated Apple App ID under the existing paid account, enable
   Associated Domains on that App ID, and obtain a matching development profile
   using the existing certificate. Register only the detected owner's phone if
   it is not already registered. No new Sign in with Apple key is needed.
2. Generate native iOS files with Expo, install Pods, build and sign locally in
   Xcode, and install only on the owner's connected iPhone. No EAS paid build,
   App Store submission, TestFlight upload, or new signing certificate is proposed.
3. Publish the verified AASA file and deploy the reviewed merged backend. The
   recorded live baseline is `4cbff93`; merged main is `19c1bbab`. Coordinate with
   the backend task so mobile activation does not overwrite concurrent agent-auth
   changes. Keep existing Apple secrets, owner allowlist, and enrollment-off state.
4. Enable `MOBILE_AUTH_ENABLED=1` and set `MOBILE_REDIRECT_URIS` to a JSON array
   containing only the exact callback above; retain canonical `PUBLIC_BASE_URL`.
   The owner performs Apple login and explicit native-session consent on device.

Accept by checking login/cancel, universal-link return, 15-minute expiry,
revocation/logout, background privacy, keyboard/dynamic text/VoiceOver, and a
synthetic job status/note/prep edit. Do not capture private board data. Confirm
web Apple login still works. Revert native activation if association/login fails.

Android follows after iOS acceptance, with its own verified signing fingerprint
and assetlinks publication approval. Agent/MCP credentials remain a separate task.

## iOS 27 startup correction

The first signed installation exited immediately. Its app-specific crash report
identified UIKit's no-scene-lifecycle assertion (`EXC_BREAKPOINT`/`SIGTRAP`), before
JavaScript ran. Expo SDK 57 provides `ExpoAppSceneDelegate`, but its generated
template did not adopt it. The local config plugin selects the SDK scene delegate,
conforms the app delegate to its factory-provider protocol, and leaves React Native
window/start ownership with the scene. It fails closed if the reviewed template
changes. Regression tests cover preservation of factory/launch subscribers,
idempotence, unknown-template rejection, and the single-window manifest.

App installation and a successful launch command alone do not establish stable
startup. Acceptance requires a surviving process plus owner-visible UI. Native
auth activation remains held until stable startup is verified.

## HTTPS authentication association correction (approved and deployed)

A controlled native probe found a valid scene presentation anchor, followed by
ASWebAuthenticationSession cancellation code 1 without a callback or Apple UI.
Apple's installed iOS 27 SDK `ASWebAuthenticationSessionCallback.h` explicitly
requires HTTPS callback hosts to be associated using web-credential domains.
The deployed setup declares only applinks, so it is missing this requirement.

Prepared correction: add `webcredentials:jobs.sandkcampbell.com` to the signed
app and add only `VHWFV2V25Z.com.sandkcampbell.jobinteltracker` to the AASA
webcredentials apps array. Universal links remain restricted to the exact native
callback path. Webcredentials association applies to the domain, not a path, and
permits OS credential association for this signed app. No credential-reading API
is added, and no provider secret, session scope, allowlist, refresh lifetime or
server authentication setting changes. The owner approved publication, deployment and installation of the newly entitled
build. The verified result below records association refresh and the phone flow.

The temporary native stdout probe is local-only and has been removed from the
SDK source. No raw errors, URLs, tickets, codes or tokens were logged.

## Verified physical iOS result

On October 4, 2026 at 4:56:42 p.m. America/New_York (20:56:42 UTC),
the owner confirmed: “Apple login page opened and returned my the board”.
This verifies provider UI, owner-completed authentication, native return and
board load on the physical iPhone. The mobile login blocker is closed.

- PR #3 merged as `54d4b009639575bc7922bac1b257d204148c6032`;
  Render deploy `dep-db1bnqbncjis73c2lpkg` is live at that commit.
- Origin and Apple CDN both returned HTTP 200 with only
  `VHWFV2V25Z.com.sandkcampbell.jobinteltracker` in webcredentials and
  `/auth/mobile/callback` as the applinks path.
- The Release build passed system codesign verification. Actual signed
  entitlements include both `applinks:jobs.sandkcampbell.com` and
  `webcredentials:jobs.sandkcampbell.com`. Installation and launch succeeded.
- Anonymous records and agent access returned 401; enrollment returned 404;
  health returned 200. No owner, agent or session policy changes accompanied
  the association correction.
- CI passed. Local checks passed 64 mobile tests, four scene-plugin tests,
  57 backend tests, TypeScript/ESLint and Ruff/mypy.
- Temporary JavaScript diagnostics were removed; temporary native SDK edits
  were restored and compared with the original source before building.
  No secrets, private board content or device identifiers are recorded here.

Remaining device acceptance: expiry, logout/revocation, live-write recovery,
background privacy and accessibility checks have not been verified in this
physical session. Android signing, association publication and physical-device
acceptance remain separate work. Automated coverage does not replace those
manual checks. No additional live writes or credentials were created.

## iOS completion pass (PR #5 installed; manual acceptance pending)

After provider acceptance, the mobile check passed again: 64 Jest tests and four
scene-plugin tests, with TypeScript and ESLint clean. The 22 backend mobile-auth
cases also passed using isolated temporary databases and synthetic identities.
These exercise expiry, logout/revocation, one-use exchange, scoped writes,
idempotency, conflict handling and interrupted login; they do not revoke the
owner's production session. Existing recovery tests cover lost responses after
commit and exact-key retry. The privacy regression now verifies inaccessible
underlying drafts during both inactive and background states, with their text
preserved on return.

Synthetic Expo Go QA on iPhone 16 Pro / iOS 18.5 confirmed normal and enlarged
text rendering. Maximum Dynamic Type exposed a fixed header that consumed the
viewport. The local correction puts the header, search/actions and footer inside
the board's virtualized list, and detail headings inside the detail scroll view.
Keyboard taps remain handled when search is focused. Independent review found
that interaction requirement; it was corrected. Normal text size was restored.
Full native scrolling/keyboard interaction and VoiceOver still need manual
acceptance; screenshots alone do not verify those interactions. PR #5 merged as `8d431a6504c2a6089a18a125a23efcd3d0c0d690`; exact merge
CI passed. The approved signed build was installed and launched on the owner's
physical phone. Signature and exact bundle/domain entitlements were verified;
the dedicated installed bundle and surviving app process were confirmed.
Owner-visible UI and the manual checks below remain pending. No logout,
revocation, live board writes or server deployment occurred during this pass.

Minimal owner sequence, when ready:

1. Without saving an edit, enter a short disposable draft, open the app switcher,
   and lock/unlock. Confirm the app preview is covered and the draft returns.
   Report only pass/fail; do not capture private board data.
2. Temporarily enable VoiceOver and larger text. Navigate a job, Notes/Prep,
   stage controls and back. Confirm labels, focus and usable scrolling, then
   restore preferred accessibility settings.
3. Allow the normal 15-minute session lifetime to elapse, then foreground or
   refresh. Confirm owner sign-in replaces board access. Do not alter the device
   clock or production lifetime.
4. Only after explicit owner approval for a logout test, use the existing sign-out
   control, reopen and verify no restored access; the owner signs in again.
5. Live-write recovery needs separate explicit test approval for a designated
   disposable record and cleanup. Until then, rely on synthetic recovery coverage
   and mark physical live writes unverified. No private test records are created.

Android is deferred until the owner is ready. No Android schedule is inferred.
