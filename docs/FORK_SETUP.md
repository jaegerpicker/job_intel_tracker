# Self-hosting and fork configuration

The root package supplies FastAPI HTTP/authentication, SQLite transactions,
private upload storage, static browser UI and an optional local stdio MCP
bridge. `mobile/` is the Fieldnotes Expo/React Native companion in the same
repository. It uses an explicit demo/live boundary and an HTTPS REST adapter.
No model provider is required. The main branch uses one SQLite application
instance; other remote development branches are not supported-main features.

## Start with synthetic data

Follow the README loopback demo command and use `docs/sample-import.json`.
Keep `.demo-data` separate from every real data directory. Mobile defaults to
its own in-memory demo; it needs neither the Python server nor login. Preserve
the existing owner's installation by using a separate checkout and data path.

For private mode without provider configuration, the server stays locked.
Configure a production instance privately only after choosing its host/storage,
verifying the stable Apple owner subject and reviewing APPLE_SETUP.md. Do not
discover ownership by removing an allowlist or copying another owner's values.

## Native identity belongs to each installation

The repository retains the established app identity and public association
default so existing installations keep their claimed links. It is public
signing metadata, not an authentication credential. Forks must choose their
own iOS bundle identifier, Android package, registered Apple app prefix and
HTTPS origin before signing or enabling native login.

The server's optional `MOBILE_APP_ID` setting overrides only the public AASA
app identity, using `TEAM_PREFIX.bundle.identifier` syntax. For example:

```sh
MOBILE_APP_ID=EXAMPLE123.com.example.fieldnotes
```

This is an inert example, not a registered App ID. An invalid/blank/wildcard
value refuses startup without echoing it. Existing installations with no
override retain their established association. It still claims only the exact
`/auth/mobile/callback` applinks path. Setting an association never grants a
session or enables native authentication.

Update `mobile/app.json` with your own native identifiers before generating
your separate app. Public live configuration uses your own canonical HTTPS
API origin and `/auth/mobile/callback` redirect. Register/verify the matching
provider callback, associated domains and signed app through the owner's
approved setup. Never put a token, private key or stable owner subject into
`EXPO_PUBLIC_*`, which is included in client bundles. Android associations need
the actual approved Android certificate fingerprint, not an invented value.

The proposed AASA artifact and previously published identifiers are historical
installation examples. Do not deploy them unchanged for another installation.
This release-preparation work does not generate native projects, sign/install
an app, register providers, access a live tracker, or deploy configuration.
