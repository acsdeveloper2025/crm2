# ADR-0025 — KYC / desk verification: read-only verifier + generic backend task-finalize

- **Status:** ACCEPTED (owner decision 2026-06-12; slice B1 built + verified). B2–B4 still pending.
- **Date:** 2026-06-12
- **Supersedes / amends:** builds on the OFFICE assignment pool (migration `0039_visit_type_pool.sql`; the
  shipped "ADR-0024" pool decision was never written as a doc — this ADR is its first written record of the
  execution half). Consistent with the frozen Case→Task→VerificationUnit model (KYC = a `KYC_DOCUMENT`
  unit subtype, **not** a separate engine) and ADR-0023 (dispatch fields, `SUBMITTED_FOR_REVIEW`/`REVOKED`
  status values added ahead of the review legs).

## Context

A desk / KYC task (`visit_type = OFFICE`, on a `KYC_DOCUMENT`-kind unit, no field visit) can already be
**assigned** to a `KYC_VERIFIER` — the OFFICE pool (`assignment_pool_roles`, mig 0039) resolves OFFICE →
KYC_VERIFIER and assignment writes `status = ASSIGNED` + `task_assignment_history`. But the **execution
lifecycle is entirely unbuilt**: there is no endpoint to record a result or complete a task, `case_tasks`
has no result/completion columns, `KYC_VERIFIER` holds only `case.view`, and there is no verifier surface
beyond the Pipeline list.

v1 shipped this as a **read-only verifier + back-office executor** model: the KYC_VERIFIER views and
downloads the assigned document, works the issuing source **externally** (phone/email/vendor) and reports
back out-of-band; a BACKEND_USER then records the official result and completes the task. The verifier
writes nothing in the CRM. The owner has chosen to keep that model in v2 (decision 2026-06-12).

## Decision

1. **`KYC_VERIFIER` stays read-only.** It may view its assigned desk tasks (Pipeline / case detail, scoped
   to `assigned_to = self`) and download the attached document (when attachments land — see ADR-0021). It
   has **no** write capability on a task. No new write permission is granted to it.

2. **A BACKEND_USER (checker) records the official result and completes the task.** Official KYC result is a
   single value `POSITIVE | NEGATIVE | REFER | FRAUD` (UPPER_SNAKE code per the naming freeze; display-mapped
   in the UI) plus a **mandatory remark**. The completion permission is `field_review.complete` — **already
   granted to BACKEND_USER** (permissions.ts + the role_permissions seed, parity-tested) and held by
   SUPER_ADMIN via `grants_all`, so **B1 needed no RBAC migration**. MANAGER/TEAM_LEADER are NOT granted it
   (deferred; the finalizer is the back-office BACKEND_USER by design). The name is intentionally generic —
   it serves both desk-finalize and the later field-review leg.

3. **Finalize is a generic task capability, not a KYC fork.** A single endpoint
   `POST /api/v2/cases/:caseId/tasks/:taskId/complete` transitions a task to `COMPLETED`, writing
   `verification_outcome`, `remark`, `completed_at`, `completed_by`. It is OCC-guarded (`version`, per
   ADR-0019) and scope-checked (out-of-scope → 404). Desk/KYC tasks finalize from `ASSIGNED → COMPLETED`
   (no field-submit leg, because the read-only verifier submits nothing). The **same** endpoint will later
   finalize field tasks from `SUBMITTED_FOR_REVIEW → COMPLETED`. Allowed transitions are enforced in the
   service layer (v2 has no status-transition DB trigger; OCC + service guard is the contract).

4. **The verifier is web-only.** OFFICE / KYC tasks should be excluded from `GET /api/v2/sync/download`
   (mobile is field-only) as defense-in-depth, mirroring v1's KYC sync exclusion. **Deferred in B1** — not
   yet exercised (OFFICE tasks are assigned only to KYC_VERIFIERs, who are web-only and whose `/sync/download`
   already filters to `assigned_to = self`; a field device never receives one). Add the explicit
   `visit_type <> 'OFFICE'` predicate when the verifier-mobile-block is hardened.

5. **No commission for desk/KYC** (there is no field agent to credit). The completed task carries its
   resolved rate (rate management, ADR-0018) for **client** billing in the MIS & Billing phase. Actual
   invoice/billing generation is out of scope here (external/Tally per the v1 billing decision).

6. **Reverification = recheck-clone** (a fresh task with its own rate, linked to the original for lineage),
   matching v1 and the frozen revisit/recheck-lineage invariant. Deferred to its own slice.

## Schema (migration 0041)

Add to `case_tasks` (all nullable; written only at completion):
`verification_outcome varchar(20)` CHECK `IN ('POSITIVE','NEGATIVE','REFER','FRAUD')`,
`remark text`, `completed_at timestamptz`, `completed_by uuid`.
`completed_by` is a **plain uuid (no FK)**, matching `assigned_by`/`created_by`/`updated_by` — actor
columns are deliberately FK-less so the dev-auth + test-auth synthetic actor ids work (the v1 uuid-audit
lesson); the TASK_VIEW LEFT JOINs `users` to resolve the display name. No change to the `status` CHECK
(already includes `COMPLETED`). Applied to dev :54329 + test :5433 (v2 builds from migrations; no prod).

## Alternatives considered

- **Single operator (Zion-style):** verifier enters the official result and completes it. Rejected — no
  segregation of duties (maker = checker), diverges most from the v1 + two-layer model, and over-grants the
  verifier.
- **Maker-checker submit:** verifier uploads evidence + findings → `SUBMITTED_FOR_REVIEW` → backend
  finalizes. Rejected **for KYC** because the read-only verifier works the source externally and records
  nothing in-app (v1 parity). The `SUBMITTED_FOR_REVIEW` status is retained for the **field** task review
  leg, which the same finalize endpoint will serve.

## Consequences / don't-regress

- The finalize endpoint is the **one** task-completion path — field review must reuse it, not fork it.
- Result/outcome lives on `case_tasks` (the task is the system of record); no parallel KYC engine.
- Any view returning a task's result MUST read `verification_outcome`/`remark`/`completed_*` from
  `case_tasks`. Wiring the `/sync/download` `verificationOutcome` from this column is **deferred** until the
  field-review leg lands (no completed task reaches a device in B1).
- OCC `version` MUST be bumped by the finalize writer (the open TOCTOU carry: every status writer bumps
  version).
- Status transitions are service-enforced; adding a new transition is a code change, not a DB edit.
