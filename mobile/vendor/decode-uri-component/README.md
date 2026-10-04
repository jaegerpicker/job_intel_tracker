# Patched decoder compatibility adaptation

This directory contains upstream `decode-uri-component@0.5.0`, downloaded from the official npm tarball, with its MIT license retained. The upstream version fixes [GHSA-vcc3-ghjq-m6fr](https://github.com/advisories/GHSA-vcc3-ghjq-m6fr) using a single-pass UTF-8 scanner for malformed input.

Expo Router 57 depends on CommonJS `query-string@7.1.3`, which calls `require('decode-uri-component')` as a function. Upstream 0.5.0 is ESM-only; blindly overriding to its npm package changes that shape and breaks the caller. The only source adaptation here removes `export default` from the function declaration and appends `module.exports = decodeUriComponent`. Decoder logic is unchanged. The local package override ensures both Node tests and Metro use this adaptation.

`UPSTREAM.json` records the official tarball SHA1 and the original `index.js` SHA256. `npm run verify:vendor` reverses the export adaptation and verifies that source hash before every CI check. Do not reformat or otherwise edit `index.js`; update it from a reviewed patched upstream release, record its provenance and rerun query-parser/security/bundle tests. A timeout-bounded subprocess test exercises 20,000 malformed percent sequences. Production source-map checks ensure each platform includes exactly this patched scanner.

This is a maintained local compatibility adaptation, not an upstream CommonJS release. Remove it when the Expo-compatible Router/query-string dependency supports the patched decoder's module interface.
