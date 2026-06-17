# Case Creation & End-to-End Pipeline Model — Design

- **Status:** Design — 2026-06-11 (CTO-approved per the autonomous-build directive; owner-approved field placements)
- **Phase:** OPERATIONS. Revisits build-order #5/#6 (Case + Task Creation) with mobile-dispatch parity, then designs the full pipeline through to complete (most stages build later).
- **Binds:** ADR-0002 (Case→Task→VU) · ADR-0012 (mobile first-class, never break) · ADR-0015 + `docs/CASE_WORKSPACE_AND_REPORTING_FREEZE.md` (workspace, two-layer result) · ADR-0019 (OCC) · ADR-0022 (one scope seam) · DATAGRID/PAGINATION/IMPORT-EXPORT freezes.
- **Amends:** `case_tasks`/`cases`/`case_applicants` schema + the create/add-tasks contract → **ADR-0023** (this design is its companion spec).
- **Inputs:** `docs/specs/2026-06-11-v1-zion-case-task-creation-audit.md` (§3 Locked Dispatch Contract is the hard constraint).

> **Scope discipline.** v2's frozen architecture stays intact. The ONLY hard external constraint is the locked field-dispatch contract (audit §3). Everything added here is v2-native; we do **not** copy v1's model — we capture the fields the unmodified mobile app reads, in the cleanest v2 home.

---

## 1. The pipeline, end to end

```
CREATE CASE ──> ADD TASKS ──> ASSIGN ──> DISPATCH ──> FIELD SUBMIT ──> REVIEW ──> COMPLETE
  (§2)           (§3)         (✅ built)   (§4 read-     (§5 ingest)    (§6 two-   (§6 + billing
                                          model)                        layer)     hooks)
```

| Stage | State | This design |
|---|---|---|
| Create case | partly built | **§2** — add `backend_contact_number`; keep dedupe gate |
| Add tasks | built (thin) | **§3** — per-task `applicant_id` + `address` + `trigger` + `priority` + `task_number`; explicit task specs replace unit×qty |
| Assign | ✅ Pipeline slice 2/3 | unchanged; OCC + history + eligibility |
| Dispatch (mobile read-model) | **not built** | **§4** — `/api/v2/sync/download`, live scoped query, byte-compatible envelope |
| Field submit (ingest) | not built | **§5** — verification submit + attachments + status transitions + idempotency |
| Review → complete | not built | **§6** — two-layer FE-evidence vs backend-official-result; SUBMITTED_FOR_REVIEW → finalize |

Build now: §2 + §3 (creation parity). Build later (named, designed here so nothing is discovered late): §4–§6.

---

## 2. Create case (§2)

Keep the existing flow (dedupe → create → add-tasks). One addition:

- **`cases.backend_contact_number` varchar(20) NOT NULL.** `CreateCaseSchema` gains a required `backendContactNumber`. The web form **prefills it from the creating user's `/me` phone** (`users.phone`, exists since migration 0025) and lets the operator edit it — matching v1, where it's a mandatory office contact. The API requires it (a case with no callable office number is invalid); auto-fill is an FE concern, not a DB default.
- Dedupe gate unchanged (advisory, decision recorded). Pincode/area capture unchanged (optional, scope only — NOT dispatched to the device).
- **Audit:** creation currently writes no audit row. Add `appendAudit` (CREATE) for the case inside the create transaction — cases become the first case-domain audit consumer (platform helper already exists). Low-risk, aligns with the append-only audit invariant.

`customerName`/`customerPhone`/`applicantType`/`customerCallingCode` are **not** stored on the case — they derive from the task's targeted applicant at dispatch (§3, §4).

### 2.1 `case_applicants` — add `calling_code`
- **`case_applicants.calling_code varchar(40)`** — auto-generated `CC-<epoch>-<rand>` per applicant at insert (v1 parity; pure display token, drives no logic). Generated in the repository (no `Date.now()`/`Math.random()` in workflow scripts — this is normal app code, allowed). The task dispatches it via `applicant_id`, so two applicants on one case get distinct codes — exactly the owner's requirement.

---

## 3. Add tasks (§3) — per-task attributes + applicant targeting

### 3.1 Contract change: explicit task specs (was unit × quantity)
Today `AddTasksSchema` = `{units: [{verificationUnitId, quantity}]}` and the repo flat-expands by quantity into bare rows. Per-task `applicant_id`/`address`/`trigger`/`priority` make a single unit's N copies **distinct**, so quantity-expansion no longer fits. New shape:

```ts
AddTasksSchema = z.object({
  tasks: z.array(z.object({
    verificationUnitId: positiveInt,            // must be CPV-enabled (unchanged check)
    applicantId: uuid,                          // FK → case_applicants of THIS case (required)
    address: z.string().trim().min(1).max(500), // dispatched as addressStreet
    trigger: z.string().trim().max(2000),       // dispatched as notes (bank instruction)
    priority: z.enum(PRIORITIES).default('MEDIUM'),
  })).min(1),
});
```

"Quantity" becomes "add N task rows" (the operator adds N entries, each with its own applicant/address). This matches Zion's Document×NO-OF *with per-row attributes*, and keeps every task independently dispatchable.

- **CPV gating unchanged:** every `verificationUnitId` must be CPV-enabled for the case's client+product (existing `allUnitsEnabled`).
- **`applicantId` validation:** must belong to THIS case (`SELECT 1 FROM case_applicants WHERE id=$1 AND case_id=$2`) → else 400 `INVALID_APPLICANT`. Prevents cross-case applicant leakage.

### 3.2 `case_tasks` — new columns (migration 0037)

| Column | Type | Notes |
|---|---|---|
| `applicant_id` | uuid NOT NULL, FK→case_applicants(id) | the person this task verifies; drives dispatched customerName/phone/type |
| `address` | text NOT NULL | free-text dispatch address (agent navigates by it) |
| `trigger` | text NOT NULL DEFAULT `''` | bank instruction → device `notes` |
| `priority` | varchar(10) NOT NULL DEFAULT `'MEDIUM'` CHECK (LOW/MEDIUM/HIGH/URGENT) | per-task |
| `task_number` | varchar(30) NOT NULL | `case_number || '-' || seq`; UNIQUE (case_id, task_number) |

`task_number` minting: inside the add-tasks transaction, `seq = (SELECT count(*) FROM case_tasks WHERE case_id=$1) + ordinal` → `CASE-000001-1`, `-2`, … (deterministic, no separate sequence; display-only for the device). Existing assignment columns (visit_type/distance_band/bill_count/version) unchanged.

### 3.3 Status enum extension
`CASE_TASK_STATUSES` today = PENDING/ASSIGNED/IN_PROGRESS/COMPLETED/CANCELLED. The execution + review legs (§5/§6) need **REVOKED** and **SUBMITTED_FOR_REVIEW**. Extend the SDK const + the `chk_case_task_status` CHECK to: `PENDING, ASSIGNED, IN_PROGRESS, SUBMITTED_FOR_REVIEW, COMPLETED, REVOKED, CANCELLED`. (Added now in the migration so §5/§6 don't re-migrate; transitions enforced in code, not a transitions table — v2 keeps logic in the repository.)

### 3.4 TOCTOU ratchet (carry honored)
Every new task **status writer** (§5 start/complete, §6 finalize) MUST bump `version` in the same UPDATE, or the assignment write's OCC must re-check status. This is the durable Pipeline carry — encoded here so §5/§6 builders can't miss it.

---

## 4. Dispatch — the mobile read-model (§4, build later)

**Decision: a live scoped query, not a materialized projection.** v1's `/sync/download` is a live LATERAL query; matching it (a) guarantees byte-compatibility, (b) reuses the v2 scope seam, (c) avoids a projection table to keep in sync. At v2's scale (≤500 users) a scoped indexed query is well within the <2s budget; a `mv_` projection is a later optimization behind the same endpoint if needed (ADR-0010 reporting pattern), never a contract change.

- **Endpoint:** `GET /api/v2/sync/download?lastSyncTimestamp&limit&offset` → the audit §3 envelope (`data.cases` == `data.changes`, `revokedAssignmentIds`, `syncTimestamp`, `hasMore`, `nextCursor`, `attachmentChanges[]`).
- **Row = one assigned task** (`case_tasks` where `assigned_to = $deviceUser`), NOT a case. Maps `MobileCaseResponse` from: `case_tasks` (id, task_number, address, trigger→notes, priority, status, assigned_at, updated_at, version, execution timestamps) + its `applicant_id` join (customerName/phone/callingCode/applicantType) + `cases` (case_number→caseId, backend_contact_number, created_by→name) + `clients`/`products`/`verification_units` (client{}, product{}, verificationType). Phantom fields (city/state/pincode/lat/lng/email) emitted as `''`/undefined to match v1 exactly.
- **Scope contract (MOBILE_API_COMPATIBILITY §"Data scope"):** the query MUST compose `resolveScope` + `taskScopePredicate` (level TASK) so a device can never sync out-of-scope tasks — enforcement never depends on the client. This is the mobile-scope contract test to add when the endpoint lands.
- **Status mapping:** v2 sends real statuses; the device collapses `SUBMITTED_FOR_REVIEW → COMPLETED` itself. `REVOKED` tasks flow via `revokedAssignmentIds` (device purges).
- **Watermark/delta:** `ORDER BY COALESCE(ct.updated_at, cs.updated_at) ASC, cs.id ASC`; offset paging; empty watermark → last 30 days. Identical semantics to v1.
- **Auth/profile:** `/api/v2/auth/login|refresh|logout` (JWT-pair, idempotent rotation), `UserProfile` with `assignedPincodes/assignedAreas` as **display data** backed by the server-side scope (they're persisted-but-unread on the device — safe).

---

## 5. Field submission ingest (§5, build later)

v2 serves the device's upstream writes byte-compatibly:
- `POST /api/v2/verification-tasks/{id}/verification/{formType}` — `{formData, attachmentIds[], verificationOutcome, formType}`. **409 = real conflict** (NOT success); idempotent replay → **200 + cached body**. Persists the FE submission as **immutable evidence** (the two-layer model — never overwritten by review). Bumps `version` (§3.4) and moves the task to `SUBMITTED_FOR_REVIEW` when the backend-review flag is on, else `COMPLETED` (mirrors the v1 epic's chokepoint normalization).
- `POST /api/v2/verification-tasks/{id}/attachments` — multipart `files/photoType/operationId/clientSha256?/geoLocation`; `Idempotency-Key` required; object-store, immutable, sha256, signed URLs; response `{success,data:{attachments:[{id,url}]}}`.
- `POST …/start|complete|revoke`, `PUT …/priority` — **409-as-success for start/complete/revoke only**; priority + form-submit excluded. Each status writer bumps `version`.
- `Idempotency-Key` dedupe (method+body+key) on every write.

---

## 6. Review → complete + billing (§6, build later)

Per `CASE_WORKSPACE_AND_REPORTING_FREEZE.md` §1 + the v1 Backend-Review epic lesson (two disjoint result layers, never overwrite):
- **FE evidence layer** = the immutable field submission (photos/GPS/form answers) from §5.
- **Backend official result layer** = a back-office reviewer records the official outcome on `SUBMITTED_FOR_REVIEW` → `finalize` → `COMPLETED`. Stored separately from the FE evidence (append-only); the two may differ and both are preserved. This is the result-coherence fix v1 lacked (the report prints the official result, never a stale case-header field).
- **Status rollup:** on task COMPLETED, recompute `cases.status` from its tasks (the rollup v2 lacks today). Lineage (revisit/recheck) deferred — a revisit is a new child task, not a mutation (v1 lesson).
- **Billing/commission hooks:** task-based, gated on COMPLETED (the v1 invariant — submit ≠ commission, finalize = commission). Out of scope for the creation slice; named here.

---

## 7. Frozen invariants honored

- Case→Task→VU (ADR-0002); Task vocabulary kept.
- ONE scope seam — dispatch + every operational list compose `resolveScope` + `composeScopePredicate` (tasks = level TASK).
- OCC: every task status writer bumps `version` (§3.4 TOCTOU ratchet); `task_assignment_history` append-only.
- Append-only audit (creation gains its first audit row, §2).
- Mobile never breaks (ADR-0012): the §4 read-model + §5 ingest serve the locked contract byte-for-byte; additive-only `/api/v2`.
- DataGrid + server pagination + Created/Updated columns + OCC ConflictDialog + uuid params validated pre-query + triple-write migrations with guards + magic-number lint — all standing standards on anything built.

---

## 8. Migration & schema summary (0037)

```
ALTER TABLE cases            ADD backend_contact_number varchar(20);   -- backfill + SET NOT NULL
ALTER TABLE case_applicants  ADD calling_code varchar(40);
ALTER TABLE case_tasks       ADD applicant_id uuid REFERENCES case_applicants(id);  -- backfill + NOT NULL
ALTER TABLE case_tasks       ADD address text;                          -- backfill + NOT NULL
ALTER TABLE case_tasks       ADD trigger text NOT NULL DEFAULT '';
ALTER TABLE case_tasks       ADD priority varchar(10) NOT NULL DEFAULT 'MEDIUM' CHECK (...);
ALTER TABLE case_tasks       ADD task_number varchar(30);               -- backfill + NOT NULL + UNIQUE(case_id, task_number)
-- extend chk_case_task_status to add SUBMITTED_FOR_REVIEW, REVOKED
```
Forward-only, idempotent (`IF NOT EXISTS` / `DO $$ … pg_constraint` guards). Dev DB :54329 + test :5433 applied per the triple-write rule (v2 has no prod yet). Backfill strategy for existing dev rows: addresses `''`→ then NOT NULL is unsafe on real data, but v2 dev data is disposable seed — the plan resets the test DB; existing dev rows get a placeholder backfill before the NOT NULL is set.

---

## 9. Open dependencies (verified)
- `users.phone` exists (migration 0025) → `backend_contact_number` default source confirmed. ✅
- Next migration = 0037. ✅
- No v2 mobile app / no `/sync/download` yet — §4 is greenfield (build later). ✅

Cross-reference: audit `docs/specs/2026-06-11-v1-zion-case-task-creation-audit.md` · `ADR-0023` · plan `docs/plans/2026-06-11-case-creation-plan.md`.
