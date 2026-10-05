# Local cross-contract verification and release dependencies

## Aging publication preparation on current main

`feat/mobile-aging-publication` is locally rebased onto main at `395ae8933e8cff9f1ab5647a37926c23d15c6328`, containing merged backend PR #8 and safe-area PR #7. Git skipped the already-merged acceptance and safe-area commits; the PR diff contains only mobile feature, tests and QA documentation. Before this documentation update, its mobile tree matched the preserved `prep/mobile-waiting-backend-pr8` tree exactly. Backend, web and non-mobile documentation match main. Original planning and preparation branches remain preserved. No aging build installation or backend deployment is implied by PR #7's direct installation approval.

## PR #7 approval and merge, October 5

Owner visual acceptance: on October 5 at 3:00:58 p.m. America/New_York, the owner answered "Yes that's much better" when asked whether the sign-out control now sits below the status bar. This confirms the narrow physical-device safe-area layout result after the verified installation and surviving launch. It does not establish keyboard, VoiceOver, background privacy, expiry, logout or live-write acceptance. No additional phone tests, publication or deployment followed this confirmation; aging-release approval remains separate and pending.

Connection follow-up: the owner's Library screenshot was materialized with the current metadata-preserving helper and inspected as actual pixels. It shows Xcode's selected target as "Tome of truth"; it is not proof of a successful installation. The selected command-line and running GUI toolchain both use `/Applications/Xcode.app` / Xcode 27.0 (27A266a). A fresh supported inventory then confirmed that the same paired physical iPhone was connected. No toolchain mismatch, pairing change or security change was established or performed. Installation of the verified PR #7 safe-area-only artifact subsequently succeeded for the dedicated app bundle. Launch succeeded and a later process query confirmed the app survived; installed bundle/version was verified as `com.sandkcampbell.jobinteltracker` / 1.0.0 (1). Owner-visible safe-area layout and manual acceptance remain unconfirmed. This supersedes the earlier unavailable-device installation blocker below; the new aging build was not installed. No login, logout, production record writes or backend deployment occurred.

The owner directly approved "PR #7 merge and deploy to iphone" in this thread. Exact head `670780f5f918eccc55fc568b7f588e4a103b22fe` had four successful checks. PR #7 was marked ready and merged at `395ae8933e8cff9f1ab5647a37926c23d15c6328` (2:49 p.m. America/New_York). This supersedes the earlier approval blocker below for PR #7 only. New workload publication and backend deployment remain separate.

Merged mobile source exactly matches the reviewed safe-area head. The prepared safe-area-only Release artifact passed strict codesign verification, has bundle identifier `com.sandkcampbell.jobinteltracker`, both expected domain entitlements and minimum iOS 17.4. Its main bundle SHA-256 is `8d5e916613dbdf18b117878269f7e440d45aa515fe7ddb2ccc0baa0116839eff`; unpublished workload editor strings are absent. Installation has not occurred: the physical owner iPhone reports unavailable. Connection/unlock is required before the approved install can proceed. No live records or auth settings were changed.

## Current local preparation after backend PR #8

Backend PR #8 is merged at `ac50887b82c6cb0472529ba25c32b767f8918c14`; its tree exactly matches reviewed backend candidate `f74c880a7241bbfd5300c7d702a545995d77e7e2`. The original reviewed mobile branch remains `feat/mobile-waiting-planning` at `611a899a50a4bf3032c23d502683d4ec95132a57`.

A separate unpublished branch, `prep/mobile-waiting-backend-pr8`, replays the six original local commits onto that backend merge. Pre-documentation head: `ff74ae8c104c131a1199e56a8fe15beb20a616c5`. Rebase completed without conflicts; `git range-diff` marks every replayed patch equal. Mobile file contents match the original branch, and backend file contents match the merged baseline. Replayed safe-area patch `a59bdba` is identical to PR #7's `670780f`; this is local preparation, not approval or publication of that still-gated dependency.

PR #7 remains draft/unmerged. Automatic approval review rejected marking it ready because the approval was relayed rather than given directly in this thread. No retry or indirect publication of its patch is permitted without direct owner approval here. Backend merging is complete, but backend deployment, mobile publication, physical-phone installation and iOS acceptance remain separate pending actions. Render remains on its previous manual deployment per the backend task; this mobile task did not access Render.

The dependency notes below record the earlier candidate verification. Current future order is: resolve the separate PR #7 approval, verify/deploy the approved merged backend, then publish the reviewed integrated mobile changes and build/install them for physical iPhone acceptance. No main branch was mutated during local integration preparation.

## Synthetic backend verification

Backend: `/tmp/job-intel-aging-workload`, commit `ccf4006340cca92e97ccd6db7aa8722ea84b795c`. Existing fixture: `http://127.0.0.1:8004`, generated from isolated synthetic records. No backend files, auth configuration or production data were changed.

Run the opt-in integration check from `mobile` while that fixture is running:

```sh
JOB_INTEL_SYNTHETIC_CONTRACT_QA=1 npm test -- --runTestsByPath tests/workload-local-contract.test.ts
```

Passed against the actual server: owner identity, parsing all 16 synthetic jobs, workload 15 open / 3 interviewing companies / 2 weekly new, record-version agreement, receipt age staying at 14 days, scheduled interview and unknown-date labels, complete-body planning write, lost acknowledgement followed by identical payload retry, repeated-key replay without a second revision, updated action-due projection, and stale-version conflict. The original synthetic body was restored with its latest version in `finally`; revision history correctly retains the QA writes.

Only the test transport maps a fixed HTTPS placeholder origin to loopback. It uses the existing inert browser session and CSRF values from the fixture. This does not test native bearer authentication or loosen the shipped HTTPS/auth boundary. No grants or credentials were created. Normal checks pass 104 Jest tests, with this one opt-in test skipped by default, plus four scene-plugin tests, lint and typecheck.

## Dependency ordering

- Shared main baseline: `757597a4af8c18f216bd6129b09fbb156d08e1fd` (PR #6).
- PR #7 head: `670780f5f918eccc55fc568b7f588e4a103b22fe`, preceded by acceptance documentation `a6c243f`. Verified remotely OPEN / draft / CLEAN. Neither merged nor installed.
- Backend aging final candidate: `f74c880a7241bbfd5300c7d702a545995d77e7e2`, building on `ccf4006340cca92e97ccd6db7aa8722ea84b795c` from the shared baseline. The final delta changes only `static/app.js`, `static/planning-ui.js` and `tests/test_planning_ui.py`: web capacity copy now says "Planning warning" only when the server supplies the open-applications warning. API schemas, projection/calendar rules, authentication and all mobile files are unchanged. The actual-server integration evidence above remains against `ccf4006`; inspection confirms it applies to the unchanged final API contract, without claiming a redundant integration rerun. Browser retesting remains owned by the backend task.
- Mobile plan documentation: `38999b371f543bb9aa7886c952a57eeb321433f3`, then feature `45ab7dfb47786467a0a3031d1efa373110e5474c`, then this verification commit. The mobile branch already contains PR #7; publishing it would publish that dependency too.
- Local `git merge-tree --write-tree ccf4006 45ab7df` succeeded without conflicts, producing tree `5a9dd9b4527b7d755f63f98999dd742af698e1d6`. This computed compatibility without changing either branch or working tree.

A future explicit approval bundle should identify PR #7, the backend commit and the final mobile head individually. Resolve PR #7 and merge the backend (their order is technically independent), deploy/verify the backend workload endpoint, then publish/merge the mobile commits on the combined baseline and build/install the reviewed iOS feature release. Phone acceptance requires live login, workload rendering and saves, keyboard/large-text/VoiceOver review, logout and expiry. Android remains deferred. The previously prepared safe-area-only artifact must not be described as containing the new feature.

No new push, PR, merge, deployment, feature signing or phone installation was performed.
Publication and installation remain on hold pending a new explicit approval naming the final candidate commits.

## Library evidence

Both images contain synthetic simulator fixtures only. The supported current Library upload workflow confirmed success and persisted local Library identity.

| Screenshot | Library ID | File ID |
| --- | --- | --- |
| jobintel-workload-board.png | libfile_59d0a51cc588819184db40c5e7361034 | file_00000000d62481f994bf13d8c01582f1 |
| jobintel-workload-plan.png | libfile_3e1b95e39fd081919ee5ed0809d532fc | file_00000000e63c821094ad6b1fdb025351 |
