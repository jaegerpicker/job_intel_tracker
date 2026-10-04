# First owner-device acceptance

Prepared October 4, 2026. Owner approved the signing, device installation, association publication, and mobile-auth activation bundle. Deployment and device acceptance remain pending.

## Verified local prerequisites

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

## HTTPS authentication association correction (pending approval)

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
server authentication setting changes. Approval is needed before publishing the
updated AASA/deploying or installing the newly entitled build. Native acceptance
still requires a refreshed Apple association cache and a successful phone flow.

The temporary native stdout probe is local-only and has been removed from the
SDK source. No raw errors, URLs, tickets, codes or tokens were logged.
