# KYC-verifier export workflow — design + build plan (2026-07-02)

**Status:** PROPOSED — awaiting owner + CTO sign-off before any feature code.
**ADR:** [ADR-0085](../adr/ADR-0085-kyc-verifier-export-workflow.md) · **Audit:**
[2026-07-02-kyc-verifier-workflow-audit.md](./2026-07-02-kyc-verifier-workflow-audit.md) · **Migration:** `0110`.
Reuses: ADR-0084 export/read-model pattern · Universal DataGrid · `platform/export` · `taskScopePredicate` ·
`audit_log_block_mutation()`.

## 0 — Owner decisions (2026-07-02)

1. **Dedicated page** for the verifier (not Pipeline presets) — two tabs: **To Export** / **Exported**.
2. **"Exported" is derived** from an append-only `task_export_events` table — NOT a `case_tasks.status`
   (mobile shares that enum; untouched).
3. **Re-export allowed** only explicitly, **with a mandatory reason**, from the Exported tab.
4. **Full-detail PII export accepted** (extends the ADR-0084 acceptance; registry §KYC-EXPORT-2026-07-02).
5. **Unified document fields, no per-type schemas** (v1 lesson): ONE field set for all 59 KYC units —
   `documentNumber` + `documentHolderName` + a label→value `documentDetails` map (an "Add detail" repeater
   covers multi-detail types like bank statements) — captured at task creation. Storage + export shape =
   exactly v1's (jsonb map, flattened to one cell); v1's per-type `custom_fields` schema layer is NOT ported.

## 1 — Data model (migration 0110)

```sql
-- (a) Unified KYC document fields — additive, nullable; FIELD tasks leave them NULL.
-- document_details = a flat label→value jsonb OBJECT (v1 `document_details` parity: multi-detail
-- types like BANK_STATEMENT carry {"BANK NAME":"…","ACCOUNT NO":"…","STATEMENT PERIOD":"…"}).
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS document_number       varchar(100);
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS document_holder_name  varchar(200);
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS document_details      jsonb;
ALTER TABLE case_tasks ADD CONSTRAINT case_tasks_document_details_object
  CHECK (document_details IS NULL OR jsonb_typeof(document_details) = 'object');

-- (b) Export tracking — append-only event ledger (immutability via audit_log_block_mutation()).
CREATE TABLE IF NOT EXISTS task_export_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id         uuid        NOT NULL REFERENCES case_tasks(id) ON DELETE CASCADE,
  case_id         uuid        NOT NULL,
  exported_by     uuid        NOT NULL REFERENCES users(id),
  format          varchar(10) NOT NULL,               -- csv | xlsx
  is_reexport     boolean     NOT NULL DEFAULT false,
  reexport_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_export_reason_required
    CHECK (NOT is_reexport OR length(btrim(coalesce(reexport_reason,''))) > 0)
);
-- The dedup guard: at most ONE first-export row per task, enforced by the DB (concurrent
-- duplicate loses with 23505, surfaced as 409 ALREADY_EXPORTED).
CREATE UNIQUE INDEX IF NOT EXISTS uq_task_first_export
  ON task_export_events (task_id) WHERE NOT is_reexport;
CREATE INDEX IF NOT EXISTS idx_task_export_events_task  ON task_export_events (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_export_events_actor ON task_export_events (exported_by, created_at DESC);
CREATE TRIGGER task_export_events_block_mutation BEFORE UPDATE OR DELETE ON task_export_events
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

-- (c) RBAC seed (default-deny; SUPER_ADMIN via grants-all).
INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('KYC_VERIFIER', 'kyc_tasks.view'),
  ('KYC_VERIFIER', 'kyc_tasks.export'),
  -- page.operations: gates the Pipeline + Cases LIST pages (owner 2026-07-02 — the KYC verifier's
  -- nav is Dashboard + KYC verification ONLY; FIELD_AGENT is web-incidental and loses them too).
  ('MANAGER',      'page.operations'),
  ('TEAM_LEADER',  'page.operations'),
  ('BACKEND_USER', 'page.operations')
ON CONFLICT DO NOTHING;
```

Notes: no backfill needed (prod has 1 OFFICE task, un-exported — correctly appears in To Export).
`case_id` denormalised for actor/case reporting without a join through a CASCADE-deleted task.

## 2 — RBAC (`@crm2/access`)

| Perm | Label (group Operations) | Holders |
|---|---|---|
| `kyc_tasks.view` | KYC Queue — View | KYC_VERIFIER (+SA grants-all) |
| `kyc_tasks.export` | KYC Queue — Export | KYC_VERIFIER (+SA grants-all) |
| `page.operations` | Operations Lists — View | MANAGER · TEAM_LEADER · BACKEND_USER (+SA) |

NOT `data.export` (would open every bulk export endpoint). `page.operations` splits "can read case data"
(`case.view`, unchanged) from "sees the Pipeline/Cases LIST pages": the verifier's nav becomes
**Dashboard + KYC verification only** (owner 2026-07-02); FIELD_AGENT (mobile-first) loses the web list pages
too. Case **detail** stays on `case.view` — his queue rows still open the case read-only. **Web-layer gate
only** (nav items + the `/pipeline` and `/cases` list routes check `page.operations`): the `/api/v2` gates are
untouched — tightening existing endpoints would break the additive-only rule for zero data benefit (the SELF
scope already limits those APIs to his own rows). **The verifier gains no write/complete capability.**

## 3 — Unified document fields through creation (v1-export parity, no per-type schemas)

v1 precedent (verified `kycVerificationController.ts:2137`): the verifier's export carried `document_number` +
`document_holder_name` as fixed columns and ALL type-specific details as ONE `document_details` jsonb map,
flattened to a single "Custom Fields" cell (`key: value, key: value`). v2 keeps that storage/export shape and
drops only the per-type admin schema layer:

- **SDK `AddTasksSchema` / create-case task spec (additive):** `documentNumber?` (max 100, toUpper),
  `documentHolderName?` (max 200, toUpper), `documentDetails?` — `z.record(z.string().trim().max(60).transform(toUpper),
  z.string().trim().max(500).transform(toUpper))`, max 12 entries. Accepted for any task, surfaced in the UI
  only for OFFICE tasks (KYC units).
- **API:** `cases.addTasks` persists the 3 columns (revisit/reassign lineage tasks carry them over from the
  parent); `CaseTaskView` gains the 3 fields additively (camelize additive contract). The mobile sync feed is
  deliberately NOT extended — OFFICE tasks never sync to a device and FIELD tasks have no document fields.
- **Web (AddTasksForm / New Case):** when the chosen unit is OFFICE/KYC, show: Document number ·
  Name on document · an **"Add detail" repeater** (label + value rows, add as many as the type needs — e.g.
  BANK_STATEMENT → Bank Name / Account No / Statement Period). Same three inputs for every unit; NO per-type
  form logic or config. Prefill: `PAN_CARD` → applicant PAN, `MOBILE_DETAILS` → applicant mobile (2-entry
  code-owned map, still editable); holder name prefills from the applicant's name. Optional at create (no hard
  block); the queue shows blanks as `—` so the backend can see what's missing before the verifier exports.
  **Detail LABEL = a standard pick-list (owner 2026-07-02, from live cases 20/21):** operators were
  free-typing the bank NAME as the label ("ICICI BANK" → header), so each bank became its own sparse
  column. The label is now a code-owned dropdown that **adapts to the unit's category** (owner 2026-07-02 — a
  bank-only list didn't fit the 58 other units): FINANCIAL → BANK NAME/ACCOUNT NUMBER/IFSC/BRANCH/
  STATEMENT PERIOD/…; IDENTITY → DATE OF BIRTH/FATHER NAME/EXPIRY/ISSUING AUTHORITY/…; BUSINESS →
  GSTIN/LEGAL NAME/TRADE NAME/…; ADDRESS → BILL NUMBER/BILL DATE/PROVIDER/…; PROPERTY/LEGAL/
  VERIFICATION/MEDICAL/OTHER each have their own set — + a common REMARK + "Other…" free-text. All 59
  units covered via 9 categories (`AvailableUnit.category` drives it); no per-type SCHEMA (just smarter
  suggestions, free-text fallback). The export code is unchanged (one column per label — now stable).
  The requirement stays in `Trigger` (owner kept the name); Trigger is also a visible+filterable
  column in the verifier's queue grid.
- **No edit endpoint in v1 of this feature** — a wrong number is fixed by revoke → recreate (existing paths).
  A small additive task-edit endpoint is a tracked follow-up (registry).

## 4 — API: `modules/kycTasks` (`/api/v2/kyc-tasks`, additive)

**Read model (ADR-0084 style):** one code-owned column registry (constant SQL, request keys validated → 400 on
unknown; no money columns in v1). Base query: `case_tasks ct JOIN cases cs … WHERE ct.visit_type='OFFICE'` +
`taskScopePredicate(actor)` — SELF-hierarchy verifier ⇒ `ct.assigned_to = me`; out-of-scope ⇒ 0 rows.

- `GET /api/v2/kyc-tasks?state=TO_EXPORT|EXPORTED` — `authorize('kyc_tasks.view')`; paginated DataGrid
  envelope; server search/sort/filter only.
  - `TO_EXPORT`: `ct.status='ASSIGNED' AND NOT EXISTS (first-export event)`.
  - `EXPORTED`: `EXISTS (first-export event)` — any status (a later revoke/complete stays visible with its
    status), plus `exportedAt/exportedBy/exportCount` from a lateral over the events.
- `GET /api/v2/kyc-tasks/export?format=&mode=current|selected|all&ids=&cols=&reexportReason=` —
  `authorize('kyc_tasks.export')`; same query + scope; `platform/export` writer (CSV RFC-4180/XLSX,
  formula-injection guard, 413 at threshold).
  - **First export (no `reexportReason`):** rows restricted to TO_EXPORT; in ONE transaction insert a
    first-export event per row then stream exactly the claimed rows. A concurrent duplicate hits
    `uq_task_first_export` → that row is excluded; if every requested row was already exported → 409
    `ALREADY_EXPORTED` (client refreshes).
  - **Re-export (`reexportReason` present, `mode=selected`):** rows restricted to EXPORTED ∩ mine; appends
    `is_reexport=true` events with the reason; streams the file. Blank reason → 400 (CHECK is the backstop).
- Columns (registry v1 — superset of v1's 16-column verifier sheet): `taskNumber, caseNumber, clientName,
  productName, unitCategory, unitName, documentNumber, documentHolderName, documentDetails, applicantName,
  applicantPan, applicantMobile, applicantCompany, trigger, priority, assignedAt, assignedByName, attachmentCount, createdAt, tatHours, status,
  exportedAt, exportedBy, exportCount` (last three EXPORTED-state only). Export file default = the
  verify-relevant subset (identifiers + document fields). v1 columns dropped deliberately: Verified By /
  Remarks / Rejection Reason / Verified Date (completion-track data — the verifier exports BEFORE
  verification, so they're always blank; visible in the grid via `status` instead).
- **`documentDetails` in the FILE = one column per label, INLINE** (owner 2026-07-02): the export builder
  takes the union of detail labels across the exported rows and splices one column per label **at the
  documentDetails position** — between Document type and Document number — so 2–3 details (BANK NAME ·
  STATEMENT PERIOD · …) sit together where the operator expects. A row without that label stays blank.
  Labels are data (operator-entered, ≤60 chars), used ONLY as header strings through the CWE-1236 formula
  escape — never in SQL. Detail labels are alphabetical within the slot.
- **Export column order (owner 2026-07-02, from the CASE-000022 layout):** `Task # · Case # · Client ·
  Product · Applicant · Document type · [detail columns] · Document number · Trigger · Priority · Assigned ·
  Assigned by · Backend contact no`. **Dropped from the export:** Name on document, Applicant PAN, Applicant
  mobile (owner: if the verifier needs those they go in the document number/details). **Added:** Backend
  contact no (`cases.backend_contact_number`) — the office contact the verifier calls to relay the result.
- Every export logs the standard `data export` structured line (actor, rowCount) **and** is now DB-queryable
  via the events table.
- **Filename = IST date-time + export number** (owner 2026-07-02): `kyc-tasks-<yyyymmdd>-<hhmm>-exp<N>.<ext>`,
  where `N` = the batch's first `task_export_events.id` — unique, sequential, quotable when the verifier
  relays the file externally ("see export #12"). No schema addition (`writeExport` gained an optional
  filename override).

**Notifications:** none added — `CASE_ASSIGNED` on all 4 assign paths, `TASK_REVOKED` to the old assignee,
and rework→assign already cover the loop (verified live). **Completion track untouched** (ADR-0032):
backend `field_review.complete` + case finalize record the official result exactly as today.

## 5 — SDK (`packages/sdk/src/kycTasks.ts`)

`KycTaskView` (the registry columns) + `KycQueueState` + `client.kycTasks.list()` / `.export()` (blob URL
builder mirroring existing `apiExport` usage). Additive module; zero change to existing SDK surfaces except
the additive `AddTasksSchema` fields + `CaseTaskView` document fields.

## 6 — Web UI

- **Nav:** "KYC Verification" (gated `kyc_tasks.view`) → `/kyc-queue`. Pipeline + Cases nav items and list
  routes now gate on `page.operations` — the verifier's nav is **Dashboard + KYC verification** only.
- **`features/kyc/KycQueuePage.tsx`:** two tabs (To Export / Exported) on the Universal DataGrid — server-side
  everything, URL state, standard loading/empty/error/permission states (DATAGRID_STANDARD +
  PAGINATION_AND_LOADING_STANDARDS). Export menu (current view / selected / all matching) on the To Export tab
  = the claim-and-download action. Exported tab: row action **Re-export…** → dialog with mandatory reason →
  download. Row click → CaseDetailPage (he has `case.view`).
- **Details rendering (owner 2026-07-02 — never one blob):** the grid's Details cell renders one
  `label · value` line per entry (multi-line cell — plain rendering, no DataGrid row-expansion feature);
  the CaseDetail task panel lists them as separate label/value rows.
- **Deliberate page behaviors (adversarial review 2026-07-02):** switching tabs clears the grid's
  search/filters (the tabs carry different column sets — independent states by design); the header
  "Export all pending" buttons + bulk-bar export live OUTSIDE the DataGrid Export menu deliberately —
  this export MUTATES state (the claim) and needs a controlled post-download refresh, so it is the
  page's primary action, not a grid menu item (documented DATAGRID_STANDARD §11 exception).
- **Affordances:** the page offers **export only** — no complete/close/submit control exists for the role
  anywhere (unchanged). Empty To-Export state: "No tasks waiting for export."
- **CaseDetailPage:** task panel shows the 3 document fields + an "Exported ✓ <time> by <name>" chip when a
  first-export event exists (additive fields on the task view) — ops-visible relay state.
- **Dashboard:** the existing OFFICE queue counters stay; the card links to `/kyc-queue` for the verifier.

## 7 — Security review (design-time)

| Threat | Answer |
|---|---|
| IDOR / scope leak | Every list/export composes `taskScopePredicate`; SELF ⇒ own rows; out-of-scope = 0 rows / 409-never-404-leak on ids not mine (excluded by the WHERE, not error text) |
| Double export race | DB partial unique `uq_task_first_export`; claim-in-transaction; 23505 → excluded/409 |
| Permission widening | 2 new perms, default-deny, seeded to KYC_VERIFIER only; NOT `data.export`; no write perm added |
| Injection | Code-owned column registry (keys validated), bound filter values, `platform/export` CWE-1236 guard |
| PII (DPDP) | Owner-accepted full-detail export for this role (registry §KYC-EXPORT-2026-07-02); events give the accountability trail (who exported what, when) |
| Event forgery/tamper | Append-only trigger; `exported_by` = actor from JWT, never client-supplied |
| Mobile contract | No status change, no removed/renamed field; additive columns only; sync feed untouched except additive fields |

## 8 — Build plan (TDD vertical slices; each ends `pnpm verify` GREEN; commit per slice at green)

- **S1 — Schema + fields through create.** mig 0110 · `@crm2/access` perms + PERMISSION_META · SDK
  `AddTasksSchema`/`CaseTaskView` additive fields · cases create/addTasks persistence. Tests: rerun-safe
  migration, fields persist + camelize, FIELD task unaffected.
- **S2 — Read model.** `modules/kycTasks` list endpoint + column registry. Tests: TO_EXPORT/EXPORTED
  filtering, scope (other verifier ⇒ 0 rows; SA sees all), 403 without perm, envelope/pagination.
- **S3 — Export + events.** Export endpoint, claim transaction, re-export with reason. Tests: file content +
  headers, event rows written, second plain export → 409/excluded, concurrent-claim (23505 path), blank
  reason → 400, formula-injection cell, 413 threshold, out-of-scope ids ignored.
- **S4 — Web + polish.** AddTasksForm document inputs + prefill map · KycQueuePage + nav + re-export dialog ·
  CaseDetail chip + document fields · `pnpm openapi` regen · docs (PROJECT_INDEX link, registry entries,
  MASTER_MEMORY §8, Claude memory). Browser-verify as a real KYC verifier on crm2_dev: login → queue → export
  file downloads → task moves to Exported (persisted event) → re-export with reason → backend completes →
  status reflects.

**Gate:** owner sign-off on this design BEFORE S1. Ask again before push/deploy (push→main auto-deploys).

## 9 — Deferred (→ COMPLIANCE_GAPS_REGISTRY §KYC-EXPORT-2026-07-02)

- Mobile down-sync `visit_type <> 'OFFICE'` defense-in-depth predicate (ADR-0025 carry-over; `sync/repository.ts:98`).
- Task document-field edit endpoint (today: revoke → recreate).
- Async ≥10k export tier (same deferral as ADR-0084; 413 is the honest ceiling).
- Exported-state column on the shared Pipeline grid (ops oversight beyond the CaseDetail chip).
