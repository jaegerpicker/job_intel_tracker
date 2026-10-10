# Google owner sign-in

Google is an optional second identity for the **same single owner**. Apple remains supported. Agents continue using their existing scoped credentials. No first visitor becomes owner; Google email, verified-email status, hosted domain, and matching Apple email never create or merge accounts.

## Deliberate enrollment or linking

A local operator must independently verify the intended Google identity's signed OpenID Connect `sub` for the intended client, then explicitly approve that subject in private configuration. Never use an email address as the subject, trust an unverified JWT decode, or paste a raw ID token into chat/logs. Google does not use the Apple bootstrap enrollment command. There is no browser-based Google enrollment or automatic linking endpoint in this implementation.

For a fresh board, the approved Google subject establishes the only owner identity. For an existing Apple-owned board, adding Google is an explicit operator decision granting that additional provider identity the same owner authority. Verify that the account belongs to the intended owner through an independent trusted channel; an email match is insufficient. Existing records and agent credentials are preserved. Removing a provider allowlist requires a restart and prevents new sign-ins; existing sessions remain valid until logout/expiry, so revoke sessions separately if retiring a compromised identity.

## Private configuration

Create/configure a Google OAuth **Web application** client only after operator approval. Register the exact HTTPS callback on the approved origin. Mobile also uses this server client through its system browser; it does not contain a Google secret or native provider token.

```sh
# Placeholders only; configure through an operator-controlled secret mechanism.
PUBLIC_BASE_URL=https://tracker.example
GOOGLE_CLIENT_ID=<web-client-id>.apps.googleusercontent.com
GOOGLE_REDIRECT_URI=https://tracker.example/auth/google/callback
GOOGLE_CLIENT_SECRET=<client-secret>
GOOGLE_OWNER_SUB=<independently-verified-approved-google-subject>
```

Instead of `GOOGLE_CLIENT_SECRET`, use `GOOGLE_CLIENT_SECRET_FILE` pointing to a readable private secret file. Configure exactly one source; never include either in `EXPO_PUBLIC_*`. Instead of `GOOGLE_OWNER_SUB`, use `GOOGLE_OWNER_SUB_FILE`, a regular operator-owned 0600 JSON file (no symlink):

```json
{
  "issuer": "https://accounts.google.com",
  "client_id": "<web-client-id>.apps.googleusercontent.com",
  "redirect_uri": "https://tracker.example/auth/google/callback",
  "sub": "<independently-verified-approved-google-subject>",
  "approved": true
}
```

The owner file binds approval to issuer/client/callback and is validated at startup; invalid or conflicting approval fails closed. Store configuration outside the public repository. Missing approval leaves Google sign-in unavailable. Use an approved, reviewed identity-verification tool to obtain the Google subject; that live operator enrollment step is intentionally not performed by these changes.

## Protocol and clients

The server requests only `openid` with code exchange, state, nonce and S256 PKCE. It validates RS256 signature against Google's fixed HTTPS JWKS endpoint, the documented issuer spellings, audience/authorized party, expiry, issued-at, nonce, and exact approved subject. Callback state must match a Secure/HttpOnly/SameSite=Lax browser cookie and a one-use five-minute database flow. The flow is consumed before exchange; failed exchanges cannot replay it. Provider errors return generic failures without logging codes, tokens, claims, or secrets. No refresh/access grant is retained or requested for persistent access.

Web offers Apple and Google according to `/auth/info`. Expo iOS/Android live clients offer both, using the same browser confirmation and native S256 handoff; provider selection is stored server-side and Apple/Google continuations cannot be interchanged. Native sessions remain 15 minutes with no refresh grant and no agent-administration authority. Expo web live mode remains unsupported and locked; use the server web board. The synthetic demo remains local-only.

## Required live acceptance (not performed here)

An operator must approve OAuth-client/consent-screen setup, supply the private client secret, independently approve the Google subject, and configure the exact callback/TLS origin. No clients, grants, credentials, secrets, account settings, production variables or deployments were changed by this implementation.

After approved setup, verify real Google and Apple web sign-in, wrong-owner rejection, cancellation, cookie/callback policies, logout/expiry, and signed iOS/Android browser returns using approved domain associations. Tests use real ephemeral JWT signing/verification but mocked token exchange/JWKS; they do not establish Google account eligibility, consent-screen readiness or physical-device behavior.

Protocol reference: [Google OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect).
