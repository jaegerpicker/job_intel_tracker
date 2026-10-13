# Third-party notices and release inventory

The project's root LICENSE declares MIT with Shawn Campbell's copyright.
`mobile/LICENSE` retains the Expo scaffold copyright/license and now also names
the project's copyright. The project license does not replace licenses of
dependencies, copied code, fonts, icons or other supplied materials.

## Copied source and assets

| Material | Evidence retained in source | Release review |
| --- | --- | --- |
| Expo mobile scaffold | `mobile/LICENSE` preserves the upstream Expo MIT notice | Retain both upstream and project notices in source distributions. |
| URI decoder 0.5.0 | `mobile/vendor/decode-uri-component/license`, README and UPSTREAM.json | Original MIT attribution preserved. CommonJS adaptation changes only export syntax; `npm run verify:vendor` checks the restored upstream hash. |
| Generated Material Symbols font | `mobile/notices/material-symbols/` preserves the wrapper MIT notice, Apache-2.0 font license and source/hash metadata from package 0.4.48 | The font appears in the freshly exported bundle assets; include these notices with any approved artifact distribution. |
| Exported route/navigation icons | `mobile/notices/expo-router/` and `mobile/notices/react-navigation-elements/` | Actual MIT notices and package provenance retained for Router assets and its copied navigation PNG/XML icons. |
| Six mobile icon/splash images | `docs/ASSET_PROVENANCE.json`, `mobile/notices/expo-template/` | Every PNG byte-matches the integrity-verified official expo-template-blank-typescript 57.0.30 tarball. Metadata declares 0BSD but the tarball ships MIT; the original MIT notice is retained. |
| Seven documentation/QA captures | `docs/` and `mobile/qa/` | Local OCR found no email addresses; six have synthetic/demo markers and one is a locked setup capture. Final visual/privacy and screenshot-rights review remains required. |

No resumes, uploaded material binaries, database or private exports were found
in the audited tracked/history file inventory. Heuristic and OCR checks are
limited; this statement does not clear arbitrary personal content or rights.

## Dependency metadata snapshot

[docs/DEPENDENCY_LICENSES.json](docs/DEPENDENCY_LICENSES.json) records the
2026-10-13 inventory of 37 pinned Python runtime/build/test dependencies and 1084 npm lock entries.
Python metadata came from the installed pinned wheels; npm metadata came from
the updated lockfile, including optional platform packages. Package metadata
is an inventory hint, not a determination of distribution rights.

Most entries identify MIT, ISC, Apache or BSD licenses. Entries needing explicit
distribution review include:

- Python certifi and pathspec: MPL metadata; typing_extensions: PSF-2.0.
- npm lightningcss and its platform packages: MPL-2.0; caniuse-lite data:
  CC-BY-4.0; node-forge: BSD-3-Clause OR GPL-2.0 metadata.
- The lock's two decoder links lack a license field but point to the retained
  local MIT-licensed decoder. `exit@0.1.2` uses a legacy MIT `licenses` field
  and includes LICENSE-MIT; its absent lockfile field is not a missing notice.

Preserve the actual upstream license/NOTICE files with any redistributed copied
source or packaged binaries. Review the exact artifact, its bundled data/native
components and any source/attribution obligations before distribution. No new
vendored library, font, model service or remote asset was introduced here.

The Docker build context now includes the root license and this notice document
and allows only reviewed Python and HTML/CSS/JavaScript source. Python package
data also uses those web asset types, excluding private-prefixed/`.env` assets;
a synthetic source/wheel test verifies private documents/keys/data stay out.
Installed Python wheels retain their own distribution license files. Native and
container artifact notices need a final inventory of the exact release build;
lockfile metadata alone does not establish that every required notice ships.

## Security snapshot is separate

The final npm advisory response on 2026-10-13 reports 49 high, zero moderate and
zero critical dependency-chain entries, from two distinct advisories and two
installed vulnerable package instances: braces and node-forge. The formatter
path was removed through the tested patched YAML caller override. These are not
49 distinct flaws or deployed runtime vulnerabilities. This is not a clean audit. See the reachability
and mitigations in [mobile/qa/DEPENDENCIES.md](mobile/qa/DEPENDENCIES.md).
Compatibility-breaking forced upgrade/downgrade proposals were not applied.
License review and vulnerability review are separate release gates.
