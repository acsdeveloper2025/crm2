# KYC / desk verification — build plan (2026-06-12)

Design: `docs/specs/2026-06-12-kyc-desk-verification-workflow-design.md` · Decision: ADR-0025.
**Paused for owner go-ahead.** Next migration = **0041**. Baseline origin/main `d952ce5` (+ local `9e285d5`
A1 sync companyName).

## Slice B1 — result-recording spine (thin vertical, no document bytes) — ✅ DONE (2026-06-12)

Goal: a backend user can record the official KYC result and complete a desk task in-app; the read-only
verifier sees it but cannot. **Built + gate green + browser-verified.** As-built deviations from the draft:
- **No RBAC migration** — `field_review.complete` was already granted to BACKEND_USER (+ SUPER_ADMIN
  grants_all); step 2 was a no-op. MANAGER/TL deferred.
- **`completed_by` is FK-less** (matches assigned_by/created_by/updated_by; the LEFT JOIN resolves the name).
- **Sync `verificationOutcome` wiring + OFFICE-exclusion deferred** (no completed task reaches a device in B1).
- **Pipeline visit-filter / finalize-from-list deferred to B3** — the verifier's scoped Pipeline already
  serves their read surface; finalize lives on CaseDetail.

1. **mig 0041** — `case_tasks` += `verification_outcome varchar(20)` CHECK(POSITIVE/NEGATIVE/REFER/FRAUD),
   `remark text`, `completed_at timestamptz`, `completed_by uuid→users`. Apply dev :54329 + test :5433.
   → verify: `\d case_tasks` shows 4 cols on both DBs.
2. **@crm2/access** — grant `field_review.complete` to BACKEND_USER (MANAGER/SUPER_ADMIN already via roles).
   → verify: roles-parity test green; matrix shows the grant.
3. **@crm2/sdk** — `CompleteTaskRequest { result, remark, version }`; `CaseTaskView` += `verificationOutcome`,
   `remark`, `completedAt`, `completedByName`; `sdk.cases.completeTask()`. KYC result enum + labels.
   → verify: sdk contract test green.
4. **API (cases module)** — `POST /cases/:caseId/tasks/:taskId/complete` (gate `field_review.complete`,
   scoped, OCC, transition guard ASSIGNED|SUBMITTED_FOR_REVIEW→COMPLETED, audit row). Add the 4 fields to
   every `CaseTaskView` SELECT (TASK_VIEW, TASK_VIEW_BY_CASE, tasks repo, sync read-model wires
   `verificationOutcome`). Bump `version` in the UPDATE.
   → verify: integration tests — happy path, missing remark 400, bad transition 409, stale 409, verifier 403,
   out-of-scope 404. `pnpm verify` EXIT=0.
5. **Web** — completion panel on CaseDetail/Pipeline for `field_review.complete` holders (Result dropdown +
   required Remark + Complete disabled-until-valid); Pipeline OFFICE/KYC filter + kind chip; verifier sees
   read-only.
   → verify (browser, dev :4000/:5273): backend user completes a desk task → COMPLETED + outcome shown;
   KYC_VERIFIER login sees it Completed, no Complete button; 0 console errors.
6. **Audit Panel** (ceo-quality-sentinel) → PASS. Local commit at green.

## Slice B2 — task / case reference attachments (object store, ADR-0021) — ✅ DONE (2026-06-12)

Owner widened scope: **task-level attachments for BOTH field and KYC tasks** (the v1 "ATTACHMENT" flow —
office uploads a reference doc the assignee reads; NOT field photo-capture). Built + gate green +
browser-verified against real MinIO.
- **mig 0042** `case_attachments` (case_id + nullable task_id; storage_key/sha256; uploaded_by FK-less;
  deleted_at soft-delete) — v1's table shape (case + optional task), ONE table for field + KYC.
- **Storage** = the existing ADR-0021 `getStorage()` seam (presigned-URL reads). **Dev = MinIO** added to
  docker-compose (`crm2_minio` :9000/:9001, bucket `crm2-dev`, init container); dev API runs with
  `STORAGE_BACKEND=minio S3_ENDPOINT=http://127.0.0.1:9000 S3_BUCKET=crm2-dev S3_ACCESS_KEY_ID/SECRET=
  minioadmin`. Tests inject a fake via `setStorage` (no MinIO needed).
- **API** (cases module): `POST /cases/:id/attachments` (case.create; raw octet-stream body + `x-filename`
  + optional `?taskId=`; magic-byte sniff PDF/PNG/JPEG/WebP via new `platform/file.ts`, 25 MiB cap; store
  BEFORE DB → unconfigured = clean 503) · `GET /cases/:id/attachments` (case.view; case-level + the actor's
  reachable-task attachments) · `GET …/:attId/url` (case.view → short-lived signed URL; scope-checked at
  issuance = IDOR-safe) · `DELETE …/:attId` (case.create; soft-delete + best-effort object remove).
- **Web**: CaseDetail `AttachmentsSection` — upload with a **target selector (Whole case / a task)**, list
  (Name/Attached-to/Type/Size/Uploaded-by/Uploaded), download opens the signed URL, delete (case.create).
- **KYC unification**: a KYC/OFFICE task's document is just a task-level attachment; the read-only verifier
  (case.view) lists + signs it (proven in the scope test). Field reference docs are the same flow.
- **Tests**: cases 49/49 (+3 attachment: full lifecycle, magic-byte reject, scope+RBAC). `pnpm verify`
  EXIT=0 (api 517, sdk 84, web build). **Browser-verified** dev :4000(minio)/:5273: PDF + PNG upload →
  rendered → signed URL fetched exact bytes from MinIO (127.0.0.1:9000) → delete → DB soft_deleted, 0
  console errors on clean render.
- DON'T-REGRESS: this is the ATTACHMENT flow (office→assignee read), NOT photo-capture; `taskScopePredicate`
  references the `cs` alias so any EXISTS subquery using it must `JOIN cases cs`; store bytes before the DB
  row; presigned URL is the only object the client sees.

## Slice B3 — Document Workspace (two-pane)

Reuse `/cases/:id` behind a feature flag (no FE flag infra yet — first build it). Left = evidence (doc
images, applicant, history), right = sticky decision panel (the B1 form). Verifier read-only variant.

## Slice B4 — reverification + client billing (deferred)

Recheck-clone (new task, fresh rate, lineage link); rate retained on completed task feeds MIS & Billing.
No commission for desk/KYC.

## Don't-regress

- Finalize is the ONE completion path (field review reuses it; don't fork for KYC).
- Result on `case_tasks` only (no parallel engine); every task SELECT returns the new columns.
- Version-bump on the finalize UPDATE (TOCTOU carry); transitions service-enforced.
- KYC/OFFICE excluded from `/sync/download` (web-only verifier).
