# Dependency security review — 2026-10-13

The final clean lockfile audit reports **49 high dependency-chain entries, zero
moderate/critical, from two distinct advisories and two installed vulnerable
package instances**. The 49 entries are overlapping consumer paths, not 49
separate flaws or 49 deployed runtime vulnerabilities. The prior snapshot had
three advisories (49 high + 5 moderate). No audit allowlist or suppression is used.

## Compatible remediation completed

The only installed `sprintf-js@1.0.3` caller was legacy `argparse@1.0.10`, pulled
by `@istanbuljs/load-nyc-config@1.1.0` → `js-yaml@3.15.2` in Jest coverage tooling.
The loader calls `js-yaml.load` for YAML files; YAML 4 retains that API. A targeted
parent override to **js-yaml 4.3.2** removes the old argparse/formatter subtree
and deduplicates YAML to one patched instance. An actual loader regression checks
synthetic YAML fields, anchors, extends, camelcased keys and cwd handling. No
application/job input reaches this configuration parser.

YAML 4.2.0 was a discarded local candidate: fresh audit found three later YAML
advisories. The retained 4.3.2 version meets their patched bounds. npm initially
kept a stale nested resolution; it was refreshed, then verified with a clean
`npm ci --ignore-scripts --no-audit --no-fund` and caller resolution. Nonstandard
YAML 3 JavaScript tags are not claimed compatible; this repository uses no such
NYC config. See the [YAML patch advisory](https://github.com/advisories/GHSA-2883-xcg3-v3hh).

The Expo SDK 57 Jest preset also received its compatible **57.0.5 → 57.0.6**
patch through Expo's dev-dependency installer. Expo 57.0.27, React 19.2.3, React
Native 0.86.3 and Jest 29.7.0 stay fixed. The SDK 57 preset still depends on Jest
29 components; no test-framework/SDK major migration is smuggled into this fix.

## Remaining distinct advisories and applicability

| Package / one installed instance each | Representative callers | Local evidence and exposure | Upgrade blocker |
| --- | --- | --- | --- |
| braces 3.0.3 — [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | micromatch → Jest config and Metro file/glob tooling | An isolated 8,003-character nested pattern, below the actual 10,000 limit, causes RangeError in compile. This confirms stack-exhaustion behavior. Repository/config globs are the relevant input; job/research/link data is never forwarded to it. Keep Metro on loopback and treat repo/config changes as executable tooling input. | Registry latest is 3.0.3 and the advisory lists no patched release. npm's Jest 30.5.2 proposal is a major migration, incompatible with the current preset's Jest 29 contract, and does not establish removal of Metro's separate path. |
| node-forge 1.4.0 — [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Expo CLI / @expo/code-signing-certificates | A fresh in-memory synthetic RSA signer confirms acceptance of an extra nested DigestAlgorithm element. This is a structural-validation diagnostic, not a claim of an actual low-exponent signature forgery. The affected verifier is used for signing certificate/CSR validation. This app has no EAS project, update signing certificate or private signing configuration; CLI returns before development certificate lookup when no project ID exists. Future signing/update workflows need separate review. | Registry latest is 1.4.0 and the advisory lists no patched release. npm's Expo 44.0.6 proposal downgrades across SDK/RN contracts and is not a safe compatible remediation. No custom cryptographic patch is claimed reviewed here. |

The local diagnostics catch errors and use synthetic data only. No real signing
key/certificate, EAS endpoint, Keychain credential or production request is used.
One physical package instance per advisory was identified; graph traversal is
bounded and deduplicated. npm's prod/dev labels are insufficient to prove app
reachability because Expo's CLI can sit under a production package dependency.

All three fresh production JavaScript source inventories must continue to
include the patched URI decoder and exclude braces, node-forge, npm uuid and
sprintf-js (`npm run verify:bundles`). This establishes JS-bundle absence only;
it does not certify native libraries, Expo Go, CI tooling or future signing.
The deployed Python service's dependency set has no npm packages. Its owner JWT
verification uses PyJWT/cryptography, not node-forge. No running deployment was
queried or changed by this audit.

## Existing targeted fixes retained

- The vendored URI decoder retains upstream 0.5.0 logic with a CommonJS export
  adaptation; provenance/Unicode/malformed input checks remain enforced.
- Xcode generation uses compatible uuid 11.1.1; actual generateUuid behavior is
  tested. App operation IDs continue to use expo-crypto.
- Native worklets/reanimated stay aligned with the current SDK contract.

Before approving release tooling, choose reviewed upstream fixes when available,
review a separate major migration if needed, or explicitly accept the two scoped
remaining tooling risks. Do not call this a clean dependency audit. No forced
major update, audit suppression, publication, signing or deployment occurred.
