# KYC-verifier office-task workflow — deep audit (2026-07-02)

**Scope:** how an office/KYC task is created and assigned to a KYC verifier; his login/dashboard/task views;
export capability; lifecycle + statuses; notifications; live prod/dev state. Built by a 5-agent parallel audit
(RBAC/scope · lifecycle · web UI · export engine · prod DB read-only) on main `9e6d06f` (= prod HEAD).
**Companion:** [design spec](./2026-07-02-kyc-verifier-export-design.md) + [ADR-0085](../adr/ADR-0085-kyc-verifier-export-workflow.md).

## 1 — The role today (RBAC + scope)

| Fact | Evidence |
|---|---|
| KYC_VERIFIER holds exactly **2 permissions**: `case.view` + `page.dashboard` — identical in code, prod, and dev `role_permissions` | `packages/access/src/permissions.ts:151` · mig `0033:75` · live prod query |
| Hierarchy = **SELF**; zero scope dimensions (PINCODE/AREA wiring removed by mig 0089, ADR-0061) | mig `0033:54` · mig `0089:13` · `platform/scope/__tests__/scope.test.ts:90` |
| Visibility predicate: `ct.assigned_to = ANY(me) OR cs.created_by = ANY(me)` — he sees **only tasks assigned to him** (+ cases he created, which is none) | `platform/scope/index.ts:79-87` · `repository.ts:94-120` |
| **Cannot complete/submit/finalize/revoke/rework** — lacks `field_review.complete` (403 on `/complete`), submit is device-only `task.execute`, all other write perms withheld. Design intent pinned in code: *"NOT the office relay role (KYC_VERIFIER), whose job is the external email loop only — it never completes"* | `permissions.ts:51-54` · `cases/routes.ts:47` · ADR-0025:20-37 |
| **Cannot export anything** — no `data.export`; every export endpoint 403s (test-proven for cases export) | `cases/routes.ts:37` · `cases.api.test.ts` |
| `user_kyc_unit_access` (ADR-0073) = assignment **eligibility only**, never read by the visibility resolver | ADR-0073:16 · `scope/repository.ts` |

## 2 — Create → assign → notify (works today)

1. **Create:** `case.create` holder (BACKEND_USER/MANAGER/TEAM_LEADER) creates the case and picks per task the
   verification unit + **visit_type = OFFICE** (`cases/service.ts:309-366`). No unit "kind" — `worker_role` +
   the operator's visit_type choice are the discriminators (ADR-0070).
2. **Pool:** OFFICE eligible assignees = active users of the OFFICE pool role (`assignment_pool_roles` →
   KYC_VERIFIER, mig 0039) **∩** active `user_kyc_unit_access` grant for the task's unit (ADR-0073, fail-closed;
   `tasks/repository.ts:301,330` · `cases/repository.ts:851-879`). Org-hierarchy leg removed by ADR-0078.
3. **Assign paths (4):** assign-at-create · single assign (PENDING→ASSIGNED, scope-guarded, eligibility
   re-validated) · pipeline bulk-assign (per-row OCC) · reassign-after-revoke (new lineage task). All four fire
   `notifyTaskAssigned` → `CASE_ASSIGNED` (fixes `de9b537` + `6bca39b`).
4. **Channels for a web-only verifier:** in-app notification row + socket.io. No FCM (no device token). Revoke
   notifies the old assignee (`cases/service.ts:575`); rework/revisit re-enters the assign path → notified.

## 3 — Lifecycle (statuses + who moves them)

`case_tasks.status`: `PENDING → ASSIGNED → IN_PROGRESS → SUBMITTED → COMPLETED | REVOKED | CANCELLED` (mig 0081).
- OFFICE tasks live only in **PENDING → ASSIGNED → COMPLETED** (IN_PROGRESS/SUBMITTED are device-only writes,
  `task.execute`). While the verifier works externally the task **stays ASSIGNED**.
- **Official result** = backend track (ADR-0032): `field_review.complete` holder calls
  `/cases/:id/tasks/:taskId/complete` (allowed from ASSIGNED or SUBMITTED, `cases/service.ts:497-527`) writing
  `verification_outcome` + mandatory remark, OCC-guarded + audited; case finalize (`case.finalize`) records the
  case verdict with a **mandatory** case-level remark (`7e07d5a`).
- **Invariant CONFIRMED:** the verifier has no path — permission or endpoint — that writes task state. His entire
  in-app job today is *looking* at his tasks.

## 4 — What he experiences in the web app

- Login lands on `/dashboard`; nav shows **Dashboard · Pipeline · Cases** only (`Layout.tsx:37-107`).
- Dashboard is OFFICE-queue-mode for him (`dashboard/service.ts:28-30` — `isOfficePoolRole`) — counters only,
  no clickable "my to-export list".
- Pipeline/Cases are self-scoped by the SELF predicate (so effectively "my tasks"), but there is **no
  export-state concept, no export button** (lacks `data.export`), and case detail hides every action button.

## 5 — Export infrastructure (what exists to reuse)

- `platform/export/*`: RFC-4180 CSV + exceljs XLSX builders, CWE-1236 formula-injection guard, `selectColumns`,
  `assertExportable` 413 at `EXPORT_JOB_THRESHOLD=10000`, structured log per export. 21 export endpoints, all
  perm-gated (`data.export` / resource perms like `mis.export`).
- **ADR-0084 MIS pattern** (freshest reference): code-owned column registry (constant SQL, keys validated → no
  injection), scope composed on every query (out-of-scope = 0 rows), money laterals gated, sync CSV/XLSX + 413.
- **Append-only models to copy:** `task_assignment_history` (mig 0036) + `audit_log` immutability trigger
  `audit_log_block_mutation()` (mig 0017). Note `audit_log.action` CHECK has no `EXPORT` — it is entity-CRUD
  shaped, not reusable as-is.

## 5b — v1 per-type document formats (owner follow-up 2026-07-02)

Audited the v1 repo (`CRM-APP-MONOREPO-PROD`): every KYC row carried two universal columns —
`document_number` + `document_holder_name` (+ free `description`, file upload) — and each `document_types` row
held an admin-defined **per-type `custom_fields` JSONB schema** (key/label/type/required; text/date/number/
select/checkbox) rendered as a dynamic per-type form into `document_details` (dump lines 3550-3563 · 4254-4294 ·
`KYCDocumentSelector.tsx:20-36,388-470` · `createCase.ts:883-906`). v1 pain pinned in code: required-flags
validated **frontend-only** (never enforced), custom fields invisible in lists, rechecks forced re-entry.

**Common denominator across all types:** document number (PAN/Aadhaar/mobile/GST/bill number…) + name on
document (defaults to applicant) — everything else was a per-type outlier (DL category, bill type, expiry).

**How the v1 verifier exported those (owner follow-up #2):** ONE endpoint `GET /api/kyc/export` (perm
`kyc.export`, dashboard Export button, current-view filters) → a 16-column XLSX ("KYC Verifications", 10k cap,
`KYC_EXPORTED` audit): Case # · Customer Name · Customer Phone · Document Category · Document Type ·
**Document Number** · **Document Holder** · **Custom Fields — the `document_details` jsonb map flattened into
ONE cell (`key: value, key: value`)** · Description · Status · Verified By · Remarks · Rejection Reason ·
Verified Date · Created Date · Assigned To (`kycVerificationController.ts:2137-2277`). **No "allocation
format" template existed** — this export sheet was the allocation artifact. So even multi-detail types (bank
statement: bank name / account no / period) were stored as one jsonb map and exported as one cell.

**Owner decision:** ONE unified set for all 59 units — `documentNumber` + `documentHolderName` +
`documentDetails` as a label→value jsonb map filled via an "Add detail" repeater (handles 2–4-detail types
with zero per-type schema) — captured at task creation; storage mirrors v1, but display/export do NOT reuse
v1's one-cell flatten: on screen = one line per detail, in the file = one column per label (owner
2026-07-02). crm2 today captures
**none** of these (task creation = unit + applicant + address/trigger/priority only; no `documentNumber`
concept exists in API/SDK — verified by grep). → FIX in design §1/§3 (mig 0110 additive columns).

## 6 — Live state (prod, read-only 2026-07-02; box HEAD = `9e6d06f`, migs through 0109)

- **1** KYC_VERIFIER (`kyc.verifier`, active) · **68** unit grants (mig-0100 seed, all units) · **1** OFFICE task
  ever — still **ASSIGNED**, never worked · **1** `CASE_ASSIGNED` notification to him (matches).
- No export/tracking artifact of any kind. Dev (`crm2_dev`): 2 test verifiers, **zero** OFFICE tasks.
- **The workflow is unexercised in prod → greenfield; no backfill/data-migration burden.**

## 7 — Gaps (every one dispositioned in the design / registry)

| # | Gap | Severity | Disposition |
|---|---|---|---|
| G1 | Verifier **cannot export** his assigned tasks — no perm, no scoped endpoint, no UI. His core job is impossible in-app | HIGH (functional) | FIX — design §API/§UI (ADR-0085) |
| G2 | **No export tracking** — nothing records who exported which task when; double-export unpreventable; compliance question unanswerable from the DB | HIGH (functional + audit) | FIX — `task_export_events` (mig 0110) |
| G3 | **No to-export/exported views** — no dedicated verifier surface; dashboard counters don't drill anywhere useful | MEDIUM (UX) | FIX — new KYC Verification page |
| G4 | Case detail gives the verifier no read-only explanation of his relay role; ops can't see export state either | LOW | FIX (S4) — exported chip on task panel |
| G5 | Mobile down-sync filters `assigned_to = me` only — **no `visit_type <> 'OFFICE'` predicate** (`sync/repository.ts:98`); a verifier logging into the mobile app would receive his OFFICE task on-device. ADR-0025 already deferred this hardening | LOW (defense-in-depth; no verifier has mobile) | DEFER → registry (recorded under §KYC-EXPORT-2026-07-02) |
| G6 | Notifications: assign/revoke/rework already covered; **no gap** (verified producers + live prod row) | — | NO-OP |

## 8 — Answers to the owner's 7 questions

1. **Create office task:** already works — case create with unit + OFFICE visit type, assign from the
   grant-gated pool (§2). No change needed.
2. **Login/dashboard:** login → dashboard OFFICE queue (§4); design adds the KYC Verification nav entry and
   **removes Pipeline + Cases from his nav** (new web-layer `page.operations` gate, owner 2026-07-02) — the
   verifier sees Dashboard + KYC verification only; case detail stays reachable from his queue rows.
3. **To-export page:** NEW dedicated **KYC Verification** page (owner-picked) — Pipeline stays generic.
4. **Export only his + no double export:** new self-scoped `/api/v2/kyc-tasks/export` + first-export claim via a
   DB partial-unique on `task_export_events` (design §3); already-exported tasks leave the To-Export list.
5. **Statuses/views:** "exported" = **derived from the event table** (owner-picked) — two tabs To Export /
   Exported; `case_tasks.status` enum untouched (mobile-safe).
6. **Notifications:** already complete (§2 · G6).
7. **Never closes:** invariant holds today (§3) and the design adds **only** view+export capability — no write
   perm, no status transition, nothing on the completion track.
8. **Per-type fields (follow-up):** v1's common denominator = document number + holder name; v2 captures the
   unified 3-field set at task creation for every KYC unit — no per-type formats (§5b, design §3).
