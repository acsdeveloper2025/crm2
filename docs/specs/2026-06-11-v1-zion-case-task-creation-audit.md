# v1 + Zion Case/Task Creation Audit — and the Locked Field-Dispatch Contract

- **Status:** Audit complete — 2026-06-11 (owner-sanctioned audit; overrides the standing "no more audits" rule for this scope only)
- **Phase:** OPERATIONS — precedes the Case & Task Creation redesign (build-order #5/#6 revisited before #9 Workspace)
- **Method:** 4 parallel read-only subagents (v1 createCase flow · v1→mobile dispatch contract + crm-mobile-native consumption · Zion entry model · v2 baseline). Every claim verified against live code; audit `.md`s were treated as untrusted.
- **The anchor (owner directive 2026-06-11):** *the data v2 sends to the field mobile app must stay EXACTLY what v1 sends.* The mobile app (`crm-mobile-native`, separate repo) is NOT changed. This document's **§3 Locked Field-Dispatch Contract** is the sacred part; everything else is context for the v2-native design (companion design doc).

---

## 1. v1 case + task creation — how it actually works

**One unified endpoint:** `POST /api/cases/create` (`CRM-BACKEND/src/routes/cases.ts:281-309`). Field cases, KYC cases, and "both" all flow through it; there is **no separate KYC create endpoint** — KYC rides as a `kycDocuments[]` array on the same payload. Legacy `/`, `/with-attachments`, `/with-multiple-tasks` were consolidated into `/create`.

**Request body:** `{ caseDetails, verificationTasks[], applicants?[], kycDocuments?[] }` (`src/types/cases.ts:41-46`). Transport is JSON, or multipart with the JSON under `req.body.data`.

### 1.1 `caseDetails` fields (createCase.ts:322-340)

| Field | Required | Notes |
|---|---|---|
| `clientId` / `productId` | Yes | re-checked active + mapped in `client_products` (createCase.ts:510-543) |
| `customerName` | Yes | falls back to `applicants[0].name`; later UPDATEd to the primary applicant's name (createCase.ts:659-668) → in practice **customer_name == primary applicant name** |
| `customerPhone` | Optional | single phone per case |
| `customerCallingCode` | Optional | FE auto-generates `CC-<ts>-<rand>` (call-routing token) |
| `priority` | Optional, default MEDIUM | LOW/MEDIUM/HIGH/URGENT |
| `backendContactNumber` | **Yes** (handler-enforced) | the office number the agent calls; `cases.backend_contact_number` NOT NULL |
| `panNumber` | Optional | |
| `verificationTypeId` | field: req / KYC: opt | |
| `applicantType` | Yes (resolved w/ fallback) | |
| `trigger` | field: req / KYC: opt | bank instruction text |
| `deduplicationDecision` / `deduplicationRationale` | Optional | recorded on the case |
| `pincode` (case-level) | Optional | **DEAD** — never written to `cases`; only task-level pincode used |

### 1.2 `verificationTasks[]` element (createValidation.ts:117-154)
`verificationTypeId` (req), `trigger` (req 1–500), `address` (req 1–500), `assignedTo` (**req** — unassigned not allowed), `priority?`, `rateTypeId?`, `areaId?`, `pincode?`. Array max 50.

### 1.3 DB writes at creation
- **`cases`** (createCase.ts:563-588): client/product, customer_name/phone/calling_code, priority, backend_contact_number (NOT NULL), pan_number, verification_type_id, applicant_type, trigger, dedup decision/rationale, status='PENDING', `case_id` from `nextval('cases_caseId_seq')` (numeric), `id` uuid.
- **`applicants`** (per applicant, createCase.ts:631-642): name, mobile, role (APPLICANT default), pan_number, id_details jsonb.
- **`case_deduplication_audit`** (conditional, non-fatal).
- **`verification_tasks`** (field, auto, verificationTaskCreationService.ts:255-285) + **`task_assignment_history`** + audit log.
- KYC path: `verification_tasks` + `kyc_document_verifications` + `kyc_verification_cycles` (createCase.ts:786-924).

### 1.4 Addresses
**No structured address table.** Address = **free-text per task** on `verification_tasks.address` (text). No residence/office/permanent split, no per-applicant or per-case address. `pincode` code resolves to `pincode_id` FK; `area_id` validated against `pincode_areas`. `latitude`/`longitude` dead at creation (set later by mobile).

### 1.5 Trigger flow (the messy part)
Bank instruction `trigger` lands at **two** places, inconsistently:
1. `cases.trigger` — case-level resolved value.
2. `verification_tasks.trigger` — **NOT written by the field-task service.** The per-task `trigger` the FE sends is stored in `verification_tasks.task_description` instead; the `trigger` column stays NULL on field tasks.

The device reads `verification_tasks.trigger` first, falling back to `cases.trigger` — so on field tasks it usually shows the **case-level** trigger. v2 will fix this by writing a clean per-task `trigger`.

### 1.6 Priority + TAT
Case `cases.priority` (default MEDIUM) and per-task `verification_tasks.priority`. TAT = `verification_tasks.estimated_completion_date` (usually NULL — the multi-task FE payload omits it). No `cases` SLA column; `first_assigned_at`/`current_assigned_at` stamped at creation for bank-SLA tracking.

### 1.7 Attachments at creation
The endpoint **accepts** multipart files but **never persists them** (cleanup only). Real attachments are a separate post-create step: FE calls `/api/attachments` per task (KYC → `/api/kyc/tasks/:id/upload`). The create transaction writes no file rows.

### 1.8 Dedupe gate
FE-mandatory: "Create" disabled until a dedupe search runs. Search (`/api/cases/deduplication/search`) matches `cases.pan_number`, `customer_phone`, `customer_name`, and `verification_tasks.address`. On a hit the user picks CREATE_NEW / USE_EXISTING; decision + rationale persist on the case row + an audit row. **Advisory, not blocking.**

### 1.9 Task creation + assignment hand-off
Tasks are **auto-created from the payload array** (one row per `verificationTasks[]` entry) inside the create transaction (verificationTaskCreationService.ts:142-350). Each task is inserted **directly in `ASSIGNED`** (assignment is mandatory at creation; the PENDING→ASSIGNED edge is implicit, recorded in history). `task_number` minted by a BEFORE-INSERT trigger: `'VT-'||lpad(nextval('verification_task_number_seq'),6,'0')`. Case status starts PENDING, rolled up later by `caseStatusSyncService`.

`task_status_transitions` allowed edges (SQL:34714-34728): PENDING→ASSIGNED/REVOKED · ASSIGNED→IN_PROGRESS/REVOKED · IN_PROGRESS→COMPLETED/REVOKED/ASSIGNED/SUBMITTED_FOR_REVIEW · SUBMITTED_FOR_REVIEW→COMPLETED/REVOKED/IN_PROGRESS · REVOKED→ASSIGNED · COMPLETED→ASSIGNED. Status CHECK: PENDING/ASSIGNED/IN_PROGRESS/SUBMITTED_FOR_REVIEW/COMPLETED/REVOKED.

### 1.10 Mobile sync projection
**There is NO materialized `task_list_projection`.** `/sync/download` is a **live query** (`mobileSyncController.ts:424`) over `cases c` + a `LEFT JOIN LATERAL` picking ONE non-KYC `verification_tasks` row per case, filtered to the agent's assigned tasks (`vt.assigned_to = $userId`; KYC excluded). Delta keyed on `c.updated_at`/`vt.updated_at`. The full field list is §3.

### 1.11 Dead-at-creation fields (exist in schema, never written by create)
`cases`: rate_type_id, completion counters, verification_data, verification_outcome, completed_at, revoke_*. `verification_tasks` (field path): **trigger** (§1.5), **applicant_type**, latitude/longitude, actual_amount, verification_outcome, started_at/completed_at, device fields, parent_task_id. No table at all for bank LAN/loan/application/branch, or structured addresses.

---

## 2. Zion entry model — UX to adopt (never the platform)

Source: the 3 transcribed Zion audits in `docs/acs-simplification-audit-2026-06-04/`. Operator = `AXISUSER`, single account, ASP.NET WebForms.

- **Two-screen core, single-page each.** `NewDataEntry` (customer header → inline dedupe → Document×NO-OF declaration → PROCESS) then `NewDataQC` (data → pickup → assign → photo → remark → **FINAL STATUS** → **CASE REPORT**), top-to-bottom, save-gated. The report is literally the last button.
- **Document × NO-OF grid** is the work-declaration primitive: each row = Document Type × quantity; **the document is the unit of verification AND assignment**. A per-row VISIT TYPE forks each into field-visit (RESI/OFFICE PROFILE → NEW VISIT) vs desk-check (ITR/FINANCIALS/PAN-photo → NO VISIT, office executive). Billing counts only visited rows.
- **Dedupe twice, both hard gates:** before create (NEW CASE ENTRY enabled only after a search) and before assign (CHECK DEDUPE per document row). Single (`CaseSearch`: Customer/PAN/Account/Mobile) + bulk (`find.html`, ≤100 comma-separated, cross-bank negative DB). Result tags `NO MATCH / NEUTRAL / RECOMMENDED` are advisory.
- **3-bucket pipeline counter bar everywhere:** CASE BUCKET → CASE ASSIGN → CASE COMPLETED. Per-row assignment **derives** LOCAL/OGL + bill from the area autocomplete; "AUTO EXECUTIVE" auto-allocates.
- **One official result, printed once** (FINAL STATUS). No second-person review (that's exactly the governance gap CRM2's two-layer model closes). "Revisit" = add another document to the case; "Refer" = a routing tag, not a rework loop.
- **Bank-MIS contract carried on the case from creation:** CASE TYPE (FRESH/CREDIT REFER/RE-VERIFICATION/RENEWAL), LOS APPLICATION ID, CPC/CITY/REGION/ZONE/STATE, two TAT pairs, named-verifier + agency seal on the sealed report.

**Adopt:** single save-gated entry, document×qty grid, search-first dedupe, persistent counter bar, derive-don't-ask assignment, one official result. **Reject:** single operator, no RBAC, no audit chain, WebForms/HTTP, baked-in portfolios.

---

## 3. THE LOCKED FIELD-DISPATCH CONTRACT (sacred — v2 must serve byte-compatibly)

The unmodified `crm-mobile-native` app consumes this. v2 may NOT remove/rename a device-read field, change a branched status code, or break the idempotency/multipart/JWT-pair/watermark semantics.

### 3.0 Critical facts
1. **The sync "case" is a TASK.** `GET /sync/download` returns one row per assigned `verification_tasks` row, keyed by `verificationTaskId`, in the `MobileCaseResponse` envelope. v2's `case_tasks` already matches this granularity.
2. **Backend auto-camelizes every row** (`db.ts` `camelizeRow`). v2 must preserve the camelCase JSON keys regardless of column naming.
3. **`SELECT c.*` sends phantom fields.** `cases` has no pincode/lat/lng/address/email columns, so on the wire today: `addressCity/State/Pincode` = `''`, `latitude/longitude/customerEmail` = `undefined`. **These are already DEAD on the wire** — v2 need not capture them for byte-compatibility. The only address the agent sees is the free-text `verification_tasks.address`.
4. **`SUBMITTED_FOR_REVIEW` → `COMPLETED`** is normalized on the device at the single ingestion point (`SyncDownloadService.ts:441-447`). v2 may send either.

### 3.1 `MobileCaseResponse` — every field (build at mobileSyncController.ts:596-662)

| Field | Source (v1) | Device verdict | v2 obligation |
|---|---|---|---|
| `id` | `vtask.id` (uuid) | **CONSUMED — hard-break if null** (sync.schema.ts:30) | `case_tasks.id` |
| `caseId` | `cases.case_id` (int) | **CONSUMED — schema-required** (string\|number) | `cases.case_number` (string; device tolerates) |
| `verificationTaskNumber` | `vtask.task_number` (`VT-000127`) | CONSUMED — card title (display-only, no parse) | `case_tasks` task number (case#+suffix by owner choice) |
| `title` / `description` | composed | CONSUMED | composed at dispatch |
| `customerName` | `cases.customer_name` (==primary applicant) | **CONSUMED — rendered** | derive from task's `applicant_id` |
| `customerPhone` | `cases.customer_phone` | CONSUMED — detail | derive from task's applicant `mobile` |
| `customerCallingCode` | `cases.customer_calling_code` | CONSUMED — detail (display-only) | derive from applicant `calling_code` |
| `customerEmail` | none | always undefined | **skip** |
| `addressStreet` | `verification_tasks.address` | **CONSUMED — agent navigates by it** | `case_tasks.address` |
| `addressCity/State/Pincode` | hardcoded/missing → `''` | always empty | **skip** |
| `latitude/longitude` | missing → undefined | sent-but-unread | **skip** |
| `status` | `vtask.status` | **CONSUMED — drives state machine** | `case_tasks.status` (enum extended; SFR→COMPLETED on device) |
| `priority` | `vtask.priority` ‖ MEDIUM | CONSUMED | `case_tasks.priority` |
| `assignedAt` | `vtask.assigned_at` | CONSUMED | `case_tasks.assigned_at` |
| `updatedAt` | `vtask.updated_at` | **CONSUMED — the delta watermark** | `case_tasks.updated_at` |
| `completedAt` | `vtask.completed_at` | CONSUMED | execution-phase column |
| `notes` | `vtask.trigger` ‖ `cases.trigger` | **CONSUMED — rendered as the trigger** | `case_tasks.trigger` |
| `verificationType` | `verification_types.name` | CONSUMED | `verification_units.name` |
| `verificationOutcome` | `cases.verification_outcome` | CONSUMED (rehydrated into submit) | task result column (later) |
| `applicantType` | `vtask.applicant_type` ‖ `cases.applicant_type` | **CONSUMED — rendered** | derive from task's applicant `applicant_type` |
| `backendContactNumber` | `cases.backend_contact_number` | **CONSUMED — office number agent calls** | `cases.backend_contact_number` |
| `createdByBackendUser` | `users.name` | CONSUMED | join creator name |
| `assignedToFieldUser` | `vtask.assigned_user_name` | CONSUMED | join assignee name |
| `verificationTaskId` / `verificationTaskNumber` | `vtask.*` | CONSUMED | as above |
| `isRevoked/revokedAt/revokedByName/revokeReason` | `vtask.*` | CONSUMED — revoke UI | execution-phase columns |
| `inProgressAt/savedAt/isSaved` | `vtask.*` | CONSUMED — state machine | execution-phase columns |
| `client {id,name,code}` | `clients.*` | CONSUMED — name rendered; **object must exist** | join clients |
| `product {id,name,code}?` | `products.*` | CONSUMED — name rendered | join products |
| `verificationTypeDetails {id,name,code}?` | `verification_types.*` | CONSUMED → form-type routing | from `verification_units` |
| `attachments` (`[]`) | hardcoded | sent-but-unread (always empty) | `[]` |
| `attachmentCount` | COUNT(attachments) | CONSUMED — badge | COUNT at dispatch |
| `formData` | `cases.verification_data` | CONSUMED — prefill | null at creation |
| `syncStatus` | `'SYNCED'` | sent-but-unread | literal |

### 3.2 Envelope / delta (mobileSyncController.ts:679-689)
`revokedAssignmentIds` (**POPULATED** — device purges these), `deletedTaskIds`/`deletedCaseIds`/`conflicts` (always-empty placeholders today), `attachmentChanges[]` (separate photo-delta array — device validates as `z.unknown()`), `syncTimestamp` (**the watermark** the device persists), `hasMore` (paging loop), `nextCursor` (sent-but-unread — device uses offset+=pageSize). `data.cases` and `data.changes` are the **same array**. Order: `COALESCE(vtask.task_updated_at, c.updated_at) ASC, c.id ASC`. Request `?lastSyncTimestamp&limit&offset`; empty watermark → last 30 days.

### 3.3 Upstream submission endpoints (device → backend; v2 must serve too)
- **Verification submit:** `POST /verification-tasks/{id}/verification/{formType}` — `{formData, attachmentIds[], verificationOutcome, formType}`. **409 is NOT success here** — all non-2xx throw to retry/DLQ (`FormUploader.ts:336-355`); successful idempotent replay returns **200** with the cached body. 9 form types.
- **Attachments:** multipart `POST /verification-tasks/{id}/attachments` — fields `files`, `photoType`, `operationId`, `clientSha256?`, `geoLocation`(JSON). `Idempotency-Key: operationId`, `required:true`. Response `{success,data:{attachments:[{id,url}]}}` — device reads `data.attachments[0].id/.url`; replay returns the same.
- **Status:** `POST …/start|…/complete|…/revoke{reason}`, `PUT …/priority`. **409-as-success for start/complete/revoke ONLY** (`TaskUploader.ts:74-82`; backend emits `TASK_ALREADY_IN_PROGRESS`/`TASK_ALREADY_COMPLETED`); **priority excluded.** All carry `Idempotency-Key`.
- **Auto-save:** `PUT/GET …/auto-save` → `{savedAt, version}`.

### 3.4 Auth + profile
`POST /auth/login {username,password,deviceId,deviceInfo?}` → `{user, tokens{accessToken,refreshToken,expiresIn:86400}}`. `user` = `{id,name,username,email,role,employeeId,designation?,department?,profilePhotoUrl?,assignedPincodes[],assignedAreas[]}`. **`assignedPincodes/assignedAreas` are persisted-but-never-read** on the device → safe to demote to display data (matches the v2 scope-contract). `GET /forms/{formType}/template` is a **rare fallback** (device builds forms locally) — additive-only, low-risk. Reference data `GET /reference/verification-type-outcomes`/`/revoke-reasons` refreshed per cycle.

### 3.5 Corrections to `MOBILE_API_COMPATIBILITY_MATRIX.md`
1. Sync envelope omits `attachmentChanges[]` + `nextCursor`; `deletedTaskIds/deletedCaseIds/conflicts` are always-empty placeholders today.
2. Form-template is overstated — the device builds forms locally; the endpoint is a fallback.
3. **409 nuance:** the global "409=already-success" is **wrong for form-submit and priority** — it applies only to start/complete/revoke. The Don't-Regress line must carve out form-submit + priority.
4. `UserProfile` omits `department`/`profilePhotoUrl` and the nullability of `designation`/`department`.
5. The matrix doesn't flag the **phantom fields** (city/state/pincode/lat/lng/email already dead on the wire) — v2 must not assume these were ever meaningfully sent.

---

## 4. Gap map — what v2 must ADD to serve the unmodified app

v2's model stays as frozen; we **add** the dispatch fields it doesn't yet capture. Placement decisions (owner-approved 2026-06-11, discussed field-by-field) are in the companion design doc + ADR-0023. Summary:

| Dispatch field | v2 today | Decision |
|---|---|---|
| `addressStreet` | absent | **`case_tasks.address`** text (per-task) |
| `notes` (trigger) | absent | **`case_tasks.trigger`** text (per-task; fixes v1's split-brain) |
| `verificationTaskNumber` | absent | **case number + suffix** (`CASE-000001-1`), display-only |
| `priority` | absent | **`case_tasks.priority`** CHECK DEFAULT MEDIUM (per-task) |
| `backendContactNumber` | absent | **`cases.backend_contact_number`** NOT NULL, FE-prefilled from creator's `/me` phone |
| `customerName` / `customerPhone` / `applicantType` | primary-applicant only | **`case_tasks.applicant_id`** FK→case_applicants NOT NULL — task targets one applicant; all three derive from it |
| `customerCallingCode` | absent | **`case_applicants.calling_code`** auto-generated per applicant; derived per task |
| city/state/pincode/lat/lng/email | absent | **skip** (dead on the wire in v1) |

**Deliberately dropped from v1 (justified):** no structured address table (v1 only sent free-text street) · no bank LAN/loan/application/branch (absent in v1's create + schema; not in the dispatch contract) · no case-level customer_name denorm (derive from the targeted applicant) · no creation-time attachments (out-of-band in v1 too).

**Cross-reference:** companion design `docs/specs/2026-06-11-case-creation-and-pipeline-model-design.md` · `ADR-0023` · plan `docs/plans/2026-06-11-case-creation-plan.md`.
