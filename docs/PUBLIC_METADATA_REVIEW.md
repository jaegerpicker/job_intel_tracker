# Public metadata scope and minimal mitigation

Reviewed source baseline: `977ed94f0c7fc87d5172718097ea74b5951d6b2f` (already-public main). Forward cleanup is local commit `7019a89bc3f68491af63de3d8560e68e5eef794c`. No remote source/settings or shared history has changed. Values are intentionally omitted.

| Category | Exact baseline source path and lines | First containing commit on baseline ancestry | Forward cleanup |
| --- | --- | --- | --- |
| device/provisioning context | `docs/MOBILE_DEVICE_ACCEPTANCE.md`: 9, 10, 12 | `8d5d1ecfce10` | Generic setup/acceptance guidance or reserved-domain example in 7019a89. |
| public signing metadata | `docs/MOBILE_DEVICE_ACCEPTANCE.md`: 10, 21, 95, 116 | `8d5d1ecfce10` | Generic setup/acceptance guidance or reserved-domain example in 7019a89. |
| deployment identity | `docs/MOBILE_DEVICE_ACCEPTANCE.md`: 114 | `5e4f6e2fc6e2` | Generic setup/acceptance guidance or reserved-domain example in 7019a89. |
| approval/owner quotation | `docs/MOBILE_DEVICE_ACCEPTANCE.md`: 45, 100, 109, 183, 199, 200 | `fea9fdba6666` | Generic setup/acceptance guidance or reserved-domain example in 7019a89. |
| Library identifiers | `mobile/qa/RELEASE_DEPENDENCIES.md`: 72, 73 | `b8f5568282a0` | Generic setup/acceptance guidance or reserved-domain example in 7019a89. |
| approval transcript | `mobile/qa/RELEASE_DEPENDENCIES.md`: 13, 21, 25, 27, 35 | `f4cb46c1a950` | Generic setup/acceptance guidance or reserved-domain example in 7019a89. |
| local fixture path | `mobile/qa/RELEASE_DEPENDENCIES.md`: 41 | `b8f5568282a0` | Generic setup/acceptance guidance or reserved-domain example in 7019a89. |
| Library identifiers | `mobile/qa/RESEARCH_REQUEST_ACCEPTANCE.md`: 23 | `55f79f2ed015` | Generic setup/acceptance guidance or reserved-domain example in 7019a89. |
| approval transcript | `mobile/qa/RESEARCH_REQUEST_ACCEPTANCE.md`: 27 | `82c7e0425a02` | Generic setup/acceptance guidance or reserved-domain example in 7019a89. |
| owner-specific domain examples | `docs/LOCAL_AGENT_SETUP.md`: 41, 55 | `c0448e755811` | Generic setup/acceptance guidance or reserved-domain example in 7019a89. |
| owner-specific domain examples | `docs/RENDER_SETUP.md`: 18 | `062ccc0c70a7` | Generic setup/acceptance guidance or reserved-domain example in 7019a89. |

The containing-commit column is a bounded search on the baseline’s ancestor history for the category marker; it does not assert that all public branch/PR copies begin there. The earlier audit covered cloned local branch/tag refs. GitHub PR-only, deleted/dangling remote objects, caches and other people’s clones remain outside that scope.

## Intentionally retained public signing metadata

`job_intel_tracker/app.py`, `mobile/app.json`, `tests/test_associations.py` and `docs/mobile-associations/apple-app-site-association.proposed.json` contain the established public app association/bundle identity. This is signing/claimed-link metadata, not a private signing key, stable owner subject or session credential. It remains to preserve the owner’s working installation. Forks use the documented public `MOBILE_APP_ID` override and their own signed app identity. The owner should confirm intended public identifiers before a new release.

## Minimal plan

1. Review and independently authorize publication of the forward-cleaned tree. Confirm any retained public signing identity and review the seven existing captures locally. A local commit does not change the currently public main branch.
2. Keep new operator/device/Library/deployment and approval details in private operational records. Public examples use reserved domains, synthetic records and no private identifiers.
3. Separately decide whether the historical operator context is acceptable or whether a reviewed clean release export is needed. An export avoids carrying old history into that new artifact but does not erase the existing public repository, refs, caches or previous downloads.
4. Any shared-history rewrite/force-push or visibility change needs separate explicit authority and coordination with existing branches/clones. None is performed or scheduled here. Metadata alone is not a confirmed credential leak; no credential revocation/rotation is inferred.

No confirmed live credential or real job/resume record was found in the reviewed scope. Private Library/device and operational metadata was found; the table names categories without reproducing those values.
