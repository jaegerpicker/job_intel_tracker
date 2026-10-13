# Native device acceptance

The repository's earlier acceptance records report successful physical iOS
Apple login/return and a later safe-area correction. Those are historical
results for the owner's installation, not verification of a new fork or this
release-preparation branch. Automated checks use synthetic data and mocked
provider endpoints. No live session is exercised by the local release audit.

## Prepare a separate installation

Read MOBILE_AUTH.md and FORK_SETUP.md. Choose your own signed application
identifiers, verified associated domains, canonical API origin and exact native
callback. Keep provider secrets and the stable owner subject in private runtime
storage. Do not copy an existing owner's signing/account settings or use a
wildcard profile to claim associated-domain acceptance.

Build, sign, provider configuration, installation and deployment each require
appropriate owner authorization. Local demo/test commands perform none of these.
No EAS service, paid build or new infrastructure is required for source checks.

## Acceptance sequence

1. Confirm a stable launch and owner-visible UI on the signed target device.
2. Check provider login, cancellation, explicit native-session consent and return
   through the registered HTTPS callback. Verify the web login still works.
3. Check claimed links, including both applinks and webcredentials on supported
   iOS versions. AASA applinks must claim only `/auth/mobile/callback`. Android
   needs its own verified certificate fingerprint and assetlinks acceptance.
4. Enter a disposable unsaved draft, background/lock the device and return.
   Confirm the preview is covered and the draft remains. Record only pass/fail;
   do not capture private board data or credentials.
5. Check keyboard navigation, large text and VoiceOver/TalkBack labels, focus,
   scrolling and controls; restore the user's preferred settings afterward.
6. Let the ordinary native-session lifetime expire, then refresh/foreground and
   verify sign-in is required. Do not change the device clock or production
   authentication lifetime.
7. Test logout/revocation only with separate owner permission; the owner restores
   their own session. Synthetic automation does not revoke a production session.
8. Test live writes/recovery only on an explicitly approved disposable record,
   with agreed cleanup. Otherwise keep these checks in a local synthetic fixture.

## Evidence and remaining limits

Scene lifecycle, secure journal recovery, conflict handling, privacy overlays
and safe-area behavior have automated coverage. The checked-in mobile QA
screenshots are described as synthetic simulator fixtures. Automated tests,
source review and screenshots do not replace target-device acceptance.

Expiry/logout, physical live-write recovery, background privacy and full
accessibility acceptance need fresh operator verification for each release.
Android device/signing acceptance is separate. Store distribution, provider
registration and deployment are not implied by a passing local check.

Keep detailed device, developer-account, Library, installation and deployment
records privately. Public evidence should contain only synthetic fixtures,
reviewed technical results and explicit limitations.
