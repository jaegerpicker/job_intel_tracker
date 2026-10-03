# Apple setup — requires explicit owner action

No live setup has been performed. Do not change DNS, create OAuth grants, generate live keys or deploy without action-time approval. Local demo exercises UI only. Automated tests validate real RSA JWT signatures and negative issuer/audience/sub/nonce/expiry/signature cases against mocked Apple exchange/JWKS; they do not establish live Apple eligibility or login success.

1. Review [Apple web configuration](https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/) and [user verification](https://developer.apple.com/documentation/signinwithapple/verifying-a-user). A Services ID must be associated with a primary App ID enabled for Sign in with Apple. Apple account/setup and environment documentation may differ about an existing App Store application; confirm eligibility in the actual developer account before assuming a web-only configuration works.
2. Choose and explicitly approve a public HTTPS domain and exact return URL, such as `https://tracker.example.com/auth/callback`. Apple does not accept localhost/IP callbacks. Do not use a real-domain default in public code or commit account identifiers.
3. Configure App ID/Services ID, registered domain/return URL and a Sign in with Apple signing key through the owner's developer account. Mount the key read-only outside the repository/image and restrict its filesystem permissions.
4. Independently obtain and verify the owner's stable Apple `sub` for this Services ID through a controlled trusted setup flow. Configure that exact subject **before enabling this app**. There is no first-user bootstrap and no email allowlist. If the subject is not known, the app stays closed; do not remove the allowlist to discover it through a public login.
5. Set these private environment variables: `APPLE_CLIENT_ID`, `APPLE_REDIRECT_URI`, `APPLE_OWNER_SUB`, `APPLE_TEAM_ID`, `APPLE_KEY_ID`, `APPLE_PRIVATE_KEY_FILE`; `APP_ENV=production` and `DATA_DIR` on a persistent private volume. Keep `TRACKER_DEMO` and `DEMO_DATA_DIR` absent. Compose passes client/redirect/subject variables; add the private key mount and remaining variables locally rather than committing them.

The server generates a five-minute ES256 client secret at request time using the mounted key, exchanges the one-time code directly with Apple, validates the ID token, then discards Apple tokens. Apple tokens never become local agent credentials.

## Live acceptance protocol

- On registered HTTPS origin, initiate login and inspect the flow cookie flags: Secure, HttpOnly, SameSite=None, five-minute expiry. Apple returns a cross-site POST containing code/state; no token appears in app URLs.
- Confirm that the owner succeeds and receives an eight-hour Secure/HttpOnly/SameSite=Lax opaque session cookie; no identity tokens are stored in the browser.
- Confirm a different Apple subject is refused, missing allowlist/config remains closed, tampered state and nonce fail, expired state fails, and replaying callback fails.
- Check Safari and another browser for the cross-site form_post flow (third-party-cookie/browser policies can affect this). Automated tests cover the cookie attributes and callback binding, not these live browser policies.
- Check logout, session expiry, CSRF rejection and unauthenticated attachment/export denial against the actual deployment.
- Check reverse proxy trusted-header/TLS behavior, no secret-bearing logs and durable volume backup/restore.

Only mark live Apple authentication verified after these tests pass with the real registered service. No personal developer email, account identifier, domain or credential belongs in public defaults.
