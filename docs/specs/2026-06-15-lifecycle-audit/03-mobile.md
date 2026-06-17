# 03 — Mobile Consumption of the Case/Task Lifecycle (READ-ONLY AUDIT)

Scope: `crm-mobile-native` (React Native, op-sqlite + SQLCipher). Audit of how the **unchanged field app** consumes and drives the case/task lifecycle. All citations `file:line`. Nothing here was edited.

**Base URL (verified):** `https://crm.allcheckservices.com/api/mobile` for dev/staging/prod (`src/config/index.ts:81-93`). All `ENDPOINTS` paths are relative to that `/api/mobile` prefix (`src/api/endpoints.ts`). The app is on **v1 (`/api/mobile/*`), NOT rebased to `/api/v2`** — confirmed.

---

## 1. LOCAL task/case status model

The device has **no separate "case" entity** — it stores one row per assigned **task** in SQLite `tasks` (`src/database/schema.ts:12-62`). `case_id` is an integer display number only; there is no case-status column.

### Device task statuses

| Source | Values | Cite |
|---|---|---|
| `TaskStatus` enum | `PENDING`, `ASSIGNED`, `IN_PROGRESS`, `COMPLETED`, `REVOKED` (server) + **local-only** `SAVED`, `SUBMITTED_PENDING_SYNC` | `src/types/enums.ts:4-13` |
| SQLite `tasks.status` | TEXT, default `'ASSIGNED'` | `schema.ts:29` |

`SAVED` / `SUBMITTED_PENDING_SYNC` are declared local-only and **never sent by backend** (`enums.ts:10-12`). In practice "saved" is represented by the boolean `is_saved` flag, NOT by `status='SAVED'` — list buckets filter on `is_saved=1 AND status!='COMPLETED'` (`src/projections/TaskListProjection.ts:83-84`).

### Local-only flags / columns (no server equivalent)

| Column (SQLite) | Type | Meaning | Cite |
|---|---|---|---|
| `is_saved` | INTEGER 0/1 | Saved-draft flag, mobile-only (backend has no `is_saved`) | `schema.ts:57`; `SyncConflictResolver.ts:120-124` |
| `saved_at`, `in_progress_at`, `completed_at` | TEXT | Local status timestamps | `schema.ts:55-56,33` |
| `is_revoked`, `revoked_at`, `revoked_by_name`, `revoke_reason` | | Revoke tracking mirror | `schema.ts:51-54` |
| `sync_status` | `SYNCED`/`PENDING`/`CONFLICT` | Per-row local sync state | `schema.ts:59`; `mobile.ts:60` |
| `last_synced_at`, `local_updated_at` | TEXT | Watermark / conflict timestamps | `schema.ts:60-61` |
| `form_data_json` | TEXT | Draft + `__submission` bookkeeping | `schema.ts:50`; `FormUploader.ts:42-47` |

`form_submissions.status`: `DRAFT`/`SUBMITTED_LOCALLY`/`SYNCED`/`FAILED` (`mobile.ts:132`; `schema.ts:115`). `attachments.sync_status`: `PENDING`/`UPLOADING`/`SYNCED`/`FAILED` (+ runtime `SKIPPED`/`ABANDONED`) (`mobile.ts:84`; `AttachmentUploader.ts:40`; `SyncDownloadService.ts:324`).

### Mapping to server statuses

Server statuses `PENDING/ASSIGNED/IN_PROGRESS/COMPLETED/REVOKED` map 1:1 onto `tasks.status`. The **one normalization**: server `SUBMITTED_FOR_REVIEW` is rewritten to `COMPLETED` at the single ingestion point (`SyncDownloadService.ts:441-447`), with `completed_at` back-filled from submit time. For the agent, submit IS completion.

DB schema version: `DB_VERSION = 18` (`schema.ts:4`).

---

## 2. Device-driven ACTIONS

All writes go through the **sync queue** (offline-first): the use-case enqueues then mutates SQLite; `SyncProcessor`/uploaders drain the queue and call the API. Every API write carries an **`Idempotency-Key` = `operation.operationId`** (`SyncUploadTypes.ts:8-12`; per-uploader below). **409 = success** on start/complete/revoke (`TaskUploader.ts:14-17,74-82,140-148`).

| Action | Trigger (file:line) | Endpoint + method | Idempotency-Key? | Request body | 409 handling |
|---|---|---|---|---|---|
| **Start** | `StartVisitUseCase.ts:47-52` → enqueue `TASK_STATUS` status `IN_PROGRESS` | `POST /verification-tasks/{id}/start` (`endpoints.ts:23`) | Yes (`TaskUploader.ts:116-119`) | `{ action: 'start' }` | 409 → SYNCED (`:140-148`) |
| **Save draft** | `SaveDraftUseCase.ts:18-32` | **No API call** — local only. Writes `form_data_json`, flips `ASSIGNED→IN_PROGRESS` | n/a | n/a | n/a |
| **Toggle Saved** | `TaskContext.tsx:200-207` → enqueue `TASK_STATUS` w/ `{isSaved,savedAt}` | (drains via start/complete path; `is_saved` is mobile-only, server ignores) | Yes | status + `isSaved` | n/a |
| **Submit/Complete form** | `SubmitVerificationUseCase.ts:255-320` → `FormRepository.createSubmission` → local `status=COMPLETED` + `sync_status=PENDING` → enqueue `FORM_SUBMISSION` | `POST /verification-tasks/{id}/verification/{formType}` (`endpoints.ts:49-65`; `FormUploader.ts:282-335`) | Yes (`FormUploader.ts:331-335`) | `MobileFormSubmissionRequest` (`api.ts:181-214`): `formData`, `attachmentIds`, `geoLocation`, `photos[]`, `metadata`, `verificationOutcome` | **NOT swallowed** — all non-2xx (incl 409) thrown → backoff/DLQ → "Resubmit" badge (`FormUploader.ts:336-356`) |
| **Complete (status-only)** | `CompleteTaskUseCase.ts:36-41` → enqueue `TASK_STATUS` `COMPLETED` | `POST /verification-tasks/{id}/complete` (`endpoints.ts:24`) | Yes (`TaskUploader.ts:121-126`) | `{ action: 'complete' }` | 409 → SYNCED |
| **Upload photo/attachment** | `AttachmentUploader.ts:160-169` (queued by CameraService → `SyncGateway.enqueueAttachment`) | `POST /verification-tasks/{id}/attachments` multipart (`endpoints.ts:32`) | **Yes — explicit header** `Idempotency-Key: operationId` (`AttachmentUploader.ts:166`) | `files`, `photoType`, `operationId`, `clientSha256` (64-hex, EXIF-stripped first), `geoLocation{lat,lng,accuracy,timestamp}` (`AttachmentUploader.ts:71-155`) | not 409-coded (idempotent replay returns 200) |
| **Revoke** | `RevokeTaskUseCase.ts:37-44` → enqueue `TASK_STATUS` `REVOKED` (CRITICAL) | `POST /verification-tasks/{id}/revoke` (`endpoints.ts:25`) | Yes (`TaskUploader.ts:128-135`) | `{ action:'revoke', reason }` | 409 → SYNCED |
| **Priority** | `TaskContext.tsx:227-233` → enqueue `TASK` `{action:'priority',priority}` | `PUT /verification-tasks/{id}/priority` (`endpoints.ts:26`; `TaskUploader.ts:66-71`) | Yes | `{ priority }` | **409 NOT treated as success** (`TaskUploader.ts:74` excludes priority) |

**Enqueue-before-mutate invariant** (Start/Complete/Revoke): queue first, then local update — a failed enqueue leaves nothing locally changed; a failed local update still has the queued action converge via the conflict resolver (`StartVisitUseCase.ts:39-51`, same comment in Complete/Revoke). Submit floor: ≥5 verification photos + ≥1 selfie + geo on every photo (`SubmitVerificationUseCase.ts:120-135`).

Common request headers (every call): `Authorization: Bearer`, `X-Platform`, `X-App-Version`, `traceparent`, `Content-Type` (`apiClient.ts:62-69,87-100`).

---

## 3. sync/download CONSUMPTION

`GET /sync/download?lastSyncTimestamp={watermark}&limit={syncBatchSize=50}&offset={n}` (`SyncDownloadService.ts:52-60`; `config.ts:53`). Loops pages while `hasMore`; `syncBatchSize=50`. Response shape `MobileSyncDownloadResponse` (`api.ts:275-288`).

**Watermark/delta logic:** reads `sync_metadata.last_download_sync_at` (`:41-44`); persists the new watermark **only after the whole cycle succeeds** (`:166-170`) — mid-cycle crash re-downloads from the old watermark (upserts are idempotent INSERT…ON CONFLICT, `:529-588`). `finally` clears `sync_in_progress` only, never the watermark (`:209-222`).

**Per-task fields the device reads** (consumed in `upsertTaskFromServer`, `:589-638`): `id`, `caseId`, `verificationTaskId`, `verificationTaskNumber`, `title`, `description`, `customerName/Phone/Email/CallingCode`, `addressStreet/City/State/Pincode`, `latitude/longitude`, `status`, `priority`, `assignedAt`, `updatedAt`, `completedAt`, `notes`, `verificationType`, `verificationOutcome`, `applicantType`, `backendContactNumber`, `createdByBackendUser`, `assignedToFieldUser`, `client{id,name,code}`, `product{id,name,code}`, `verificationTypeDetails{id,name,code}`, `formData`, `isRevoked`, `revokedAt`, `revokedByName`, `revokeReason`, `inProgressAt`, `savedAt`, `isSaved`, `attachmentCount`. Top-level arrays: `revokedAssignmentIds`, `deletedTaskIds`, `deletedCaseIds`, `conflicts`, `syncTimestamp`, `hasMore` (`:114-145`).

**Required (hard-break) vs tolerated:** Validation is **non-strict** `validateResponse` + Zod `.passthrough()` (`:69-72`; `sync.schema.ts:26-56`). A new/renamed field only logs a telemetry warning — never bricks the agent. **Hard-required identity fields:** `id` (`z.string().min(1)`) and `caseId` (`string|number`); a missing/null `id` or `caseId` fails schema (`sync.schema.ts:26-34`). Additionally, `upsertTaskFromServer` **skips** any row whose `verificationTaskId || id` resolves empty (`:425-432`). `cases` must be an array. Everything else (`status`, `updatedAt`, all detail fields) is `.optional()` with safe local defaults (e.g. `priority||'MEDIUM'` `:607`, `status||'ASSIGNED'` via resolver `SyncConflictResolver.ts:86`).

**Conflict resolution** (`SyncConflictResolver.resolveTaskState`): if queued changes in-flight OR local fresher OR local `is_saved`/`COMPLETED` ahead of server → preserve local; else accept server (`SyncConflictResolver.ts:81-163`). Server-side revoke detected on sync wipes local attachments + drafts (`SyncDownloadService.ts:644-670`).

---

## 4. LOCKED CONTRACT FIELDS — must never be removed/renamed/retyped

Derived from code that hard-depends on them. Renaming/removing any of these silently breaks the device (or hard-breaks for the identity fields).

**Hard-break (schema-enforced) — sync/download `cases[]`:**
- `id` (string, non-empty) — primary key, FK joins (`sync.schema.ts:27`; `SyncDownloadService.ts:425`)
- `caseId` (string|number) — display + dedupe/stale-row migration (`sync.schema.ts:29`; `:456-461`)

**Identity / routing (device builds API URLs from these):**
- `verificationTaskId` (UUID) — canonical backend task id; ALL writes resolve to it; non-UUID → "Invalid task identifier" (`StartVisitUseCase.ts:9-23`, identical in Complete/Revoke/Submit)
- `verificationTaskNumber` (e.g. `VT-000127`) — display only, treated as opaque string

**Status / lifecycle enum values (string-compared verbatim):**
- `status` ∈ `PENDING|ASSIGNED|IN_PROGRESS|COMPLETED|REVOKED|SUBMITTED_FOR_REVIEW` (`enums.ts:4-9`; normalize `SyncDownloadService.ts:441`; buckets `TaskListProjection.ts:83-90`)
- `priority` (string)

**Write request fields the backend must keep accepting:**
- Status writes: `{ action: 'start'|'complete'|'revoke', reason? }` (`TaskUploader.ts:116-135`)
- Priority: `PUT …/priority { priority }` (`TaskUploader.ts:66-71`)
- Form submit: `formData`, `attachmentIds`, `geoLocation{latitude,longitude,accuracy,timestamp}`, `photos[]{attachmentId,type,geoLocation,metadata}`, `metadata`, `verificationOutcome` (`api.ts:181-214`)
- Attachment multipart: `files`, `photoType`('verification'|'selfie'), `operationId`, `clientSha256`, `geoLocation` (`AttachmentUploader.ts:74-155`)
- `Idempotency-Key` header honored on every write (`SyncUploadTypes.ts:8-12`)

**Sync/download envelope keys:** `cases[]`, `revokedAssignmentIds[]`, `deletedTaskIds[]`, `deletedCaseIds[]`, `syncTimestamp`, `hasMore`, `conflicts[]` (`api.ts:275-288`; `SyncDownloadService.ts:114-145`).

**Form-type slugs (URL path segments):** `residence, office, business, residence-cum-office, dsa-connector, builder, property-individual, property-apf, noc` (`endpoints.ts:49-65`; `FormUploader.ts:282-292`).

**Reference endpoints** consumed each cycle (non-fatal): `/reference/verification-type-outcomes`, `/reference/revoke-reasons` (`endpoints.ts:88-91`; `SyncDownloadService.ts:231-284`).

---

## 5. SUBMITTED_FOR_REVIEW / REVOKED comprehension

- **REVOKED:** fully understood. It's a server status (`enums.ts:9`), drives local purge of attachments/drafts (`SyncDownloadService.ts:644-670`), and `revokedAssignmentIds[]` triggers `purgeTaskTransactional` (`:114-122`). Revoke is also a device-initiated action.
- **SUBMITTED_FOR_REVIEW:** the device does **NOT** model it as a distinct state. It is **normalized to `COMPLETED` at the single ingestion point** (`SyncDownloadService.ts:441-447`) — the only reference to the string anywhere in `src/`. The agent's mental model is `…→IN_PROGRESS→(submit)→COMPLETED`; the backend-review limbo is invisible to them. No SUBMITTED_FOR_REVIEW tab, label, color, or filter exists.
- **Unrecognized status reaction (graceful, never crashes):** Zod keeps `status` optional + passthrough, so an unknown status persists as-is into SQLite. The UI renders `status.replace('_',' ')` or `'UNKNOWN'` (`TaskCard.tsx:221`), `getStatusColor` falls to a muted default (`TaskCard.tsx:79-80`), and list buckets fall through `else if (statusFilter) status=?` (`TaskListProjection.ts:88-90`) — an unknown status simply lands in no standard tab and shows a grey pill. No hard-break, but **such a task becomes invisible** in the four standard tabs (Assigned/In-Progress/Saved/Completed) and dashboard counts ignore it (`schema.ts:585-589`).

So: the device expects the classic `IN_PROGRESS→COMPLETED` happy path plus REVOKED, and treats anything else (including any new v2 state that reaches the wire un-normalized) as a grey "UNKNOWN" orphan.

---

## 6. Device assumptions v2 must honor + breakage points

**Assumptions v2 must honor:**
1. Endpoint surface `/api/mobile/*` (v1) stays live and shape-compatible — device is hard-coded to it (`config.ts:81-93`); not on `/api/v2`.
2. `verificationTaskId` is a real UUID matching `^[0-9a-f]{8}-…$`; any write throws "Invalid task identifier" otherwise (`StartVisitUseCase.ts:9-23`).
3. `id` + `caseId` always present & non-null on every `cases[]` row (schema-required; `sync.schema.ts:27-29`).
4. Status string is one of the known six; new states must be reduced to a known one server-side OR the agent sees "UNKNOWN".
5. start/complete/revoke are **idempotent and return 409 when already in/past state** (`TaskUploader.ts:14-17`).
6. Submit endpoints return 200 (not 409) for successful idempotent replay; a 409 is now treated as a real error (`FormUploader.ts:336-356`).
7. `Idempotency-Key` is honored — same key + same body = dedup (`SyncUploadTypes.ts:8`; `AttachmentUploader.ts:118-122`).
8. Sync watermark semantics: `lastSyncTimestamp` query param + `syncTimestamp`/`hasMore` in response (`SyncDownloadService.ts:52-60,143-145`).
9. Submit = completion. No company-side review state is surfaced; follow-up work must arrive as a **new task** with its own payout (`SyncDownloadService.ts:435-440`).
10. Form submit accepts ≥5 photos + ≥1 selfie with geo on each (`SubmitVerificationUseCase.ts:120-135`).

### Top 5 ways v2's new lifecycle could break the device

| # | Risk | Mechanism / cite |
|---|---|---|
| 1 | **A new lifecycle state reaches the device un-normalized** (e.g. v2 adds `QC_PENDING`, `RETURNED`, `RECHECK`, a real `SUBMITTED_FOR_REVIEW`). | Only `SUBMITTED_FOR_REVIEW→COMPLETED` is mapped (`SyncDownloadService.ts:441`). Any other new status persists as a grey "UNKNOWN" pill (`TaskCard.tsx:221`) and **falls into no tab / no dashboard count** → task effectively disappears for the agent (`TaskListProjection.ts:88-90`; `schema.ts:585-589`). |
| 2 | **v2 re-opens a submitted task** (review bounce back to IN_PROGRESS/RETURNED on the *same* task instead of a new task). | Device already normalized it to local `COMPLETED` and may have purged synced photos (`FormUploader.ts:99-129`); conflict resolver prefers local `COMPLETED` over server downgrade when queued/fresher (`SyncConflictResolver.ts:127-136`) → server re-open silently ignored, agent never re-does the work. Violates assumption #9. |
| 3 | **Endpoint move to `/api/v2` or path/verb change** (e.g. start/complete become PATCH, or form slug renamed). | Hard-coded v1 paths & verbs (`endpoints.ts`; `TaskUploader.ts:48-71`); form slugs verbatim (`FormUploader.ts:282-292`). 404/405 → not 409 → retry → DLQ → "Resubmit" stuck; no auto-rebase. |
| 4 | **409 semantics change on submit** (v2 returns 409 for benign idempotent replay, or start/complete stop returning 409 when already-done). | Submit treats every 409 as a real failure → DLQ + false "Upload Failed" (`FormUploader.ts:336-356`); conversely start/complete/revoke rely on 409=success (`TaskUploader.ts:74-82,140-148`) — losing it turns idempotent retries into hard failures. |
| 5 | **Identity-field churn** — renaming/removing `id`, `caseId`, or making `verificationTaskId` non-UUID (e.g. v2 case-centric ids). | `id`/`caseId` are schema-hard-required → whole row drops on validation (`sync.schema.ts:27-29`); empty `verificationTaskId||id` → task skipped at upsert (`SyncDownloadService.ts:425-432`); non-UUID `verificationTaskId` → every write throws (`StartVisitUseCase.ts:9-23`). Any of these silently strands assignments on-device. |

Secondary: dropping `Idempotency-Key` honoring → duplicate submissions/photos on retry; changing the `geoLocation`/`photos[]`/`clientSha256` body shape → EXIF/tamper-evidence and ≥5-photo gate break; removing the two `/reference/*` endpoints is tolerated (local fallback) (`SyncDownloadService.ts:176-197`).
