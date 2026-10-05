# Mobile waiting and workload integration plan

Planning only. API-dependent implementation waits for the backend contract.
No feature publication, merge, phone installation or production changes are
approved. Android remains deferred.

## Preserve the pending iOS release

PR #7 remains draft at reviewed commit `670780f`. Its safe-area fix and signed
artifact are not installed. Existing phone installation is PR #5. This planning
branch starts from the safe-area branch to preserve that correction, but must
not publish it as part of the new feature without resolving its separate release
approval. Rebase on merged main when the safe-area release is resolved; never
replace the pending artifact with a feature build.

## Integration boundaries

- `src/domain.ts`: add explicit stored next-action/date types and runtime
  validation once field names, formats and null semantics are confirmed. Keep
  derived attention separate from fields sent through `prepareWrite`.
- `src/api.ts` / `src/runtime.ts`: preserve HTTPS, owner identity, expiry,
  versioned writes and journal idempotency. Adapt only the confirmed response
  contract. Never infer interview status, rejection or permission from a badge.
- `src/demo.ts`: synthetic jobs across waiting thresholds, explicit scheduled
  and promised dates, different action owners and both capacity categories.
  Use an injectable clock and the agreed derivation rules, not real job data.
- `App.tsx`: compact board badges with readable labels; detail next-action owner
  and due-date editor; separate open-application and interview-company counts.
  Two applications per week is planning guidance, not an automatic write block.
  Preserve scrollable headers, the root safe-area frame, keyboard behavior,
  drafts and accessible selected/disabled states.
- Mobile tests: exact 7/14-day boundaries, scheduled/promised precedence,
  date/timezone and absent/malformed-field behavior, terminal stages and linked
  jobs/company counting, conflict and exact-key retry, accessible labels and
  draft preservation. Derived fields must never become persisted write data.

## Contract questions that block dependent implementation

Confirm the reference event for waiting age and whether dates are local calendar
values or UTC instants. Confirm override priority, overdue behavior and missing
history handling. Confirm next-action owner values and default due date. Specify
which stages count as open applications or active interviewing, how primary and
linked jobs group into companies, and whether 15/three are hard limits or advice.
Define how existing `active_cap` policies migrate or remain compatible. Specify
where derived attention is returned and whether the server supplies its clock.

## Acceptance after implementation

Run mobile checks and independent review. Reproduce board/detail/edit/recovery
with synthetic simulator fixtures at standard and larger text sizes. Distinguish
automated and simulator evidence from physical phone acceptance. Keep production
sessions, records and credentials untouched. Prepare a concrete PR/build only
when separately authorized.
