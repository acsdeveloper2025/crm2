# RE-AUDIT 18: Business Logic

Re-audited fresh against HEAD `8ded432` (remediation range `b19039e..8ded432`). Scope: dedupe-export
permission gate, ADR-0078 assignment-pool acceptance, export-job scoping, and any collateral in the
cases/tasks/verification-tasks services from the 4-wave diff.

## Fix Confirmations

| ID | Status | Evidence file:line |
|----|--------|--------------------|
| BUSINESS_LOGIC-02 | CONFIRMED_FIXED | `apps/api/src/modules/cases/routes.ts:20` — `/dedupe-search/export` now `authorize(PERMISSIONS.DEDUPE_VIEW)` (was `DATA_EXPORT`; confirmed by `git diff b19039e..8ded432 -- routes.ts`), matching its view sibling `:21`. Regression test present: `cases.api.test.ts:454` asserts a `dedupe.view`-less FIELD_AGENT → 403. No lockout: `packages/access/src/permissions.ts:106/124/135` show every `DATA_EXPORT` role (MANAGER/TEAM_LEADER/BACKEND_USER, plus SA) also holds `DEDUPE_VIEW`, so the DEDUPE_VIEW audience ⊇ the old DATA_EXPORT audience — the narrowing removes no entitled role. |
| BUSINESS_LOGIC-01 | ACCEPTED_AS_DOCUMENTED | `apps/api/src/modules/cases/repository.ts:830-838` — `assignableUsers` still uses `getScopedUserIds(actor)` (hierarchy scope), unchanged by remediation (`repository.ts` not in the diff stat). Matches ADR-0078 (`ADR-0078-…md`, "Design"): the generic non-territory `assignableUsers` list "stays hierarchy-scoped — it is a visibility filter, not the work-eligibility pool." Registry disposition ACCEPTED_RISK at `COMPLIANCE_GAPS_REGISTRY.md:1664`. |
| BUSINESS_LOGIC-03 | STILL_DEFERRED_AS_DOCUMENTED (NO-ACTION) | `apps/api/src/platform/export/job.ts:43-47` — `ExportBuild` signature still `actorId: string`; file not in the remediation diff stat. Only registered builder remains `locations` (global reference catalog, no scope). Registry NO-ACTION/YAGNI at `COMPLIANCE_GAPS_REGISTRY.md:1683`. Not "fixed wrong" — untouched, as documented. |

## New Findings

None.

Collateral review of the full remediation diff for the three modules (`git diff b19039e..8ded432 --stat`
— only `cases/{routes,controller,service}.ts` + `cases.api.test.ts` touched; `tasks/` and
`verificationTasks/` entirely untouched):

- `cases/service.ts:344-360` — PERFORMANCE-01 pool cache in the assign-at-create eligibility re-check.
  Verified behaviorally equivalent: the cache key `` `${visitType} ${pincodeId ?? ''} ${areaId ?? ''}
  ${verificationUnitId ?? ''}` `` is a total function of exactly the four inputs to
  `eligibleAssigneesForNew`, which are `visitType` (enum) + three numeric IDs (`repository.ts:853-855`),
  so no space/collision risk in the key. The per-task `INVALID_ASSIGNEE` guard is preserved. No
  business-logic regression.
- `cases/service.ts:755-756` (AV malware scan on upload) and `cases/controller.ts:419-424`
  (INPUT_VALIDATION-01 safe filename decode) are from other audit areas; both add validation, neither
  weakens a case/assignment/finalize path.

## Verdict

**PASS.** All three claimed dispositions are confirmed against the live code: BUSINESS_LOGIC-02 is a real,
complete one-line gate change (`DATA_EXPORT`→`DEDUPE_VIEW`) backed by a regression test, and it locks out
no entitled role because the DEDUPE_VIEW seed audience is a superset of the DATA_EXPORT one;
BUSINESS_LOGIC-01 remains the ADR-0078-sanctioned hierarchy-scoped visibility filter (repository untouched);
BUSINESS_LOGIC-03's export-job `actorId` signature is unchanged and still YAGNI-correct with only the
scope-free `locations` builder registered. The only other diff touching these modules is the
behaviorally-equivalent PERFORMANCE-01 cache plus two unrelated validation hardenings — no regression, no
new Medium+ finding.
