# Native device acceptance

This public checklist replaces historical operator/device/deployment notes. Automated tests and historical Apple acceptance do not establish acceptance of the current build or the new Google provider.

Use a signed build, an approved HTTPS origin and verified platform domain associations. Keep all credentials, device identifiers and private board data outside public artifacts. Use synthetic fixtures for write acceptance.

For each enabled provider on each supported native platform, verify:

- Owner sign-in, cancellation, wrong-owner rejection and return through the exact native callback.
- Deliberate browser confirmation, one-use handoff, interrupted login and process restart.
- Fifteen-minute expiry, logout/revocation, secure storage and device-lock behavior.
- App-switcher privacy, keyboard interaction, large text and VoiceOver/TalkBack.
- Synthetic write conflict/retry recovery with the original idempotency key.

Google code/JWT protocol and native handoff are covered by synthetic tests. New live Google web/iOS/Android acceptance remains pending. Android signed-device acceptance remains pending. Expo web live mode is unsupported; use the server web client. Refer to [mobile protocol](MOBILE_AUTH.md) and [Google setup](GOOGLE_SETUP.md) for current configuration. Publication, deployment and device installation require separate approval.
