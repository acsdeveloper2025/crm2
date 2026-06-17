# KYC / desk verification workflow — design (2026-06-12)

**Scope:** how a desk / KYC task (no field visit) is assigned to a KYC verifier and taken to COMPLETED in
v2. Owner-sanctioned audit + design; **build paused for go-ahead.** Decision record: ADR-0025. Audit inputs:
v1 KYC controller, Zion NO-VISIT desk flow, v2 OFFICE-pool baseline.

## Model (owner decision 2026-06-12: read-only verifier, v1 parity)

```
Backend user creates case → adds an OFFICE task on a KYC_DOCUMENT unit, targeting one applicant
  → (OFFICE pool) assigns it to a KYC_VERIFIER at create, or leaves PENDING → assigned later
  → status ASSIGNED + task_assignment_history          [ALREADY BUILT — mig 0039]

KYC_VERIFIER (web only, read-only):
  → sees the assigned desk task (Pipeline / case detail, scoped assigned_to = self)
  → views applicant + case detail, downloads the attached document        [download needs attachments]
  → works the issuing source EXTERNALLY (phone / email / vendor); writes NOTHING in the CRM
  → reports the finding back to the backend user out-of-band

BACKEND_USER (checker):
  → opens the task, records the official KYC result (POSITIVE/NEGATIVE/REFER/FRAUD) + mandatory remark
  → optionally uploads the source's reply document
  → POST /cases/:caseId/tasks/:taskId/complete  → status COMPLETED        [NEW — this design]
  → task carries verification_outcome + remark + completed_at/by; rate retained for client billing
```

No `SUBMITTED_FOR_REVIEW` step for KYC (the read-only verifier submits nothing) — the task goes
`ASSIGNED → COMPLETED` directly via the generic finalize endpoint. The same endpoint serves the later field
review leg (`SUBMITTED_FOR_REVIEW → COMPLETED`).

## What already exists (no rebuild)

- OFFICE → KYC_VERIFIER pool + assign-at-create + eligibility (`assignment_pool_roles`, mig 0039;
  `eligibleAssigneesForNew`, `eligibleAssignees`). Territory is skipped for OFFICE.
- KYC = 59 `KYC_DOCUMENT` units, CPV-gated; **no** separate KYC engine (frozen).
- Verifier read surface: `GET /api/v2/tasks` (Pipeline) + `GET /api/v2/cases/:id` are `case.view`-gated and
  task-scope-composed (`assigned_to = self` for a SELF-hierarchy role) → a KYC_VERIFIER already sees its
  assigned desk tasks. `case_tasks.status` CHECK already allows `COMPLETED`. `version` exists for OCC.

## What must be built (the gap)

| Layer | Gap | Slice |
|---|---|---|
| DB | `case_tasks` has no result/completion columns | B1 (mig 0041) |
| RBAC | `field_review.complete` exists as a constant but is unwired; not granted | B1 |
| API | no task-completion endpoint; no status-transition enforcement | B1 |
| Web | no completion form for the backend user; no desk-task filter for the verifier | B1 |
| Attachments | no attachment table / object store → verifier can't download a doc, backend can't upload the reply | B2 (ADR-0021) |
| Workspace | the two-pane Document Workspace (evidence left / decision right) is unbuilt | B3 |
| Reverify / billing | recheck-clone + client billing | B4 (deferred) |

## Generic finalize endpoint (B1 contract)

`POST /api/v2/cases/:caseId/tasks/:taskId/complete`
- gate `field_review.complete`; scope-checked (out-of-scope → 404).
- body `{ result: 'POSITIVE'|'NEGATIVE'|'REFER'|'FRAUD', remark: string (required, non-empty), version: number }`.
- service: load task (FOR-context, scoped) → assert `status IN ('ASSIGNED','SUBMITTED_FOR_REVIEW')` (else 409
  `INVALID_TRANSITION`) → OCC `UPDATE … SET status='COMPLETED', verification_outcome, remark, completed_at=now(),
  completed_by, version=version+1 WHERE id AND version=$v` → 409 `STALE` on 0 rows → append audit row.
- returns the updated `CaseTaskView` (now carrying outcome/remark/completed_*).

`CaseTaskView` + every task-returning SELECT gains `verificationOutcome`, `remark`, `completedAt`,
`completedBy(Name)`; `/sync/download` wires its (today-empty) `verificationOutcome` from this column.

## UX (Zion lessons, applied)

- **Verifier:** Pipeline filtered to OFFICE / KYC, read-only; a "kind" chip (FIELD/DESK/KYC) on each row so
  the verifier knows not to expect field photos/GPS. View + download only.
- **Backend user (finalize):** a sticky decision panel on the case/task — one **Result** dropdown (default
  unset, forces a conscious choice) + a required **Remark** textarea + a **Complete** button disabled until
  both are valid (no server round-trip to validate). Mirrors v1's `KYCCompletionForm` and Zion's single
  FINAL STATUS. The full two-pane Document Workspace (evidence left, decision right) is slice B3.

## Verification (B1 done = )

- Migration 0041 applied dev + test; `case_tasks` has the 4 columns.
- API: complete an ASSIGNED desk task → 200, status COMPLETED, outcome+remark persisted; missing remark →
  400; wrong source status → 409 INVALID_TRANSITION; stale version → 409; KYC_VERIFIER calling complete →
  403; out-of-scope task → 404.
- Browser: backend user completes a desk task end-to-end; verifier sees it move to Completed and cannot
  complete it. `pnpm verify` EXIT=0.

## Open questions for the owner (before/within build)

1. **Attachments now or later?** A "real" KYC verification involves a document the verifier downloads + a
   reply the backend uploads — both need the object store (B2). B1 ships the result-recording spine
   **without** document bytes. Build B1 alone first (useful for result-tracking), or bundle B2 so the first
   shippable flow includes the document? (Recommend B1 first; B2 next.)
2. **Verifier desk view:** is the scoped Pipeline enough for now, or is a dedicated "My Desk Tasks" page
   wanted in B1? (Recommend: Pipeline filter in B1; dedicated workspace in B3.)
