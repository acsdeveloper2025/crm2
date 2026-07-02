# ADR-0085 — KYC-verifier export workflow: event-tracked, export-only queue

**Status:** Accepted · Owner-approved (2026-07-02) · **Date:** 2026-07-02 · **Migration:** `0110`
(`task_export_events` + 3 additive `case_tasks` document columns + RBAC seed). **Extends:** ADR-0025 (read-only desk verifier), ADR-0073 (unit-grant
eligibility), ADR-0084 (code-owned export pattern). **Supersedes nothing** — purely additive.
**Design spec:** [docs/specs/2026-07-02-kyc-verifier-export-design.md](../specs/2026-07-02-kyc-verifier-export-design.md) ·
**Audit:** [docs/specs/2026-07-02-kyc-verifier-workflow-audit.md](../specs/2026-07-02-kyc-verifier-workflow-audit.md).

## Context

The KYC verifier's real job is: receive OFFICE task assignments, **export** the task details, verify with the
issuing source externally (email/WhatsApp/phone), relay the result back externally; a backend user records the
official outcome and completes the task. ADR-0025 froze the "verifier never completes" half; the export half was
never built — the role today holds only `case.view` + `page.dashboard`, cannot hit any export endpoint, and no
export tracking exists anywhere, so "don't re-export an already-exported task" is unenforceable. There is also
nowhere to record WHAT to verify: v1 captured `document_number` + `document_holder_name` + admin-defined
per-type `custom_fields` JSONB per document type; crm2 captures none of it (an Aadhaar/GST/passport number has
no home). Prod state is greenfield (1 verifier, 1 OFFICE task ever). Owner decisions (2026-07-02): dedicated
page · "exported" derived from an event table (not a task status) · re-export allowed with a mandatory reason ·
full-detail PII export accepted for this role · **one unified document-field set for all 59 KYC units — no
v1-style per-type field schemas.**

## Decision

**We give KYC_VERIFIER exactly one new capability — export-with-tracking — via an append-only
`task_export_events` table, a self-scoped `/api/v2/kyc-tasks` read-model + export endpoint, and a dedicated
two-tab web page. The `case_tasks` status machine, completion track, and mobile contract are untouched.**

1. **Exported is a derived state, not a status.** `task_export_events(task_id, exported_by, format,
   is_reexport, reexport_reason, created_at)` — append-only (reuses the `audit_log_block_mutation()` trigger).
   A task is "exported" ⇔ a first-export event exists. `case_tasks` gains no column; the shared status enum
   (mobile consumes it) is untouched.
2. **No double export, enforced by the DB.** Partial unique `uq_task_first_export ON task_export_events
   (task_id) WHERE NOT is_reexport` — the export transaction claims tasks by inserting first-export events;
   a concurrent duplicate loses at the index, not at application logic. Already-exported tasks leave the
   To-Export list; selecting one for a plain export → 409 `ALREADY_EXPORTED`.
3. **Re-export is explicit + reasoned.** From the Exported tab only, with a mandatory reason
   (CHECK-enforced: `NOT is_reexport OR reexport_reason` non-blank), appended as a new event — full trail.
4. **RBAC additive, default-deny:** new `kyc_tasks.view` (page + list) + `kyc_tasks.export` (export/re-export),
   seeded to KYC_VERIFIER only (mig 0110); SUPER_ADMIN via grants-all. NOT `data.export` — that would open
   every bulk export endpoint to the role. Plus `page.operations` (MANAGER/TEAM_LEADER/BACKEND_USER) gating
   the Pipeline + Cases list surfaces in the WEB layer only — the verifier's nav collapses to
   **Dashboard + KYC verification** (owner 2026-07-02; FIELD_AGENT loses the incidental web lists too); case
   detail stays on `case.view`; `/api/v2` gates untouched (additive-only holds — SELF scope already limits
   those APIs to his own rows).
5. **Scope = the existing task predicate.** Every list/export query composes `taskScopePredicate` → the
   SELF-hierarchy verifier gets only `assigned_to = me`; out-of-scope = 0 rows / 404 (never IDOR). Base filter
   `visit_type = 'OFFICE'`.
6. **Export engine + columns follow ADR-0084:** code-owned column allow-list (constant SQL, keys validated →
   400 on unknown), `platform/export` sync CSV/XLSX + formula-injection guard + 413 threshold. No money
   columns in v1 (nothing `billing.view`-gated leaves via this surface).
7. **Unified document fields, no per-type schemas.** Three additive nullable `case_tasks` columns —
   `document_number` (the identifier: PAN/Aadhaar/mobile/GST/bill number…), `document_holder_name` (name on
   the document, prefilled from the applicant), `document_details` **jsonb label→value map** entered via a
   generic "Add detail" repeater (multi-detail types like BANK_STATEMENT carry Bank Name / Account No /
   Statement Period as N rows) — captured at task creation for OFFICE/KYC tasks, same three inputs for all 59
   units. **Rendering is never one blob** (owner 2026-07-02): the grid/case-detail show one label·value line
   per entry, and the export FILE spreads the union of labels into one spreadsheet column per label (blank
   where absent) — an improvement over v1's single flattened "Custom Fields" cell
   (`kycVerificationController.ts:2137`); v1's storage shape (one jsonb map) is kept, its per-type
   `document_types.custom_fields` admin-schema layer is NOT ported (required-flags were never enforced and it
   forced per-type config).
8. **The verifier still never completes.** No new write permission beyond the export event; the UI offers
   export affordances only. Backend completion + case finalize (ADR-0032) unchanged. Notifications unchanged
   (assign/revoke/rework producers already cover the role — verified live).
9. **Separate KYC dashboard (2026-07-02).** The shared ops dashboard is pipeline-centric — its tiles link
   into `/pipeline`, which the verifier can no longer open (`page.operations`). So the read-only KYC verifier
   (`kyc_tasks.view && !page.operations`) gets a KYC-specific dashboard at the same `/dashboard` route:
   To Export / Exported / Total / Oldest-waiting cards computed from the shipped `/kyc-tasks` counts, each
   routing into `/kyc-queue`. No new API/route/migration/RBAC (reuses `page.dashboard` + the queue endpoint);
   his `/dashboard/stats` fetch is suppressed. A full RBAC re-audit of the verifier's reachable routes found
   **no cross-scope leak** — he is pure SELF (`assigned_to = me`) after mig 0089, so `/api/v2/tasks` and
   `/api/v2/cases` return only his own OFFICE task + its case (empirically verified). Registry §KYC-verifier
   separate dashboard + RBAC re-audit.
10. **Full case/task lockdown (2026-07-02, mig 0111).** The verifier must NEVER open case/task detail:
    `case.view` is removed from KYC_VERIFIER (his perms are now `page.dashboard` + `kyc_tasks.view` +
    `kyc_tasks.export`) and the KYC-queue row-click is gone. This also closes his incidental `/cases` +
    `/tasks` reach (they were SELF-scoped — no leak, but not his job). He keeps **see + download HIS OWN
    task's reference attachments** via a new `kyc_tasks.view`-gated pair — `GET /api/v2/kyc-tasks/:taskId/
    attachments` + `/:attachmentId/url` — row-scoped to a task assigned to him (foreign task → [] / 404,
    IDOR-safe); the queue's Attachments count is a button → dialog → presigned download. Registry
    §KYC verifier full case/task lockdown.

## Consequences

- The owner's loop (assign → notify → export → external verify → external relay → backend records result)
  becomes fully supported with a per-task, immutable who/when export audit; compliance can answer
  "who exported what" from the DB.
- One new table + two perms + one module + one page; zero mobile/SDK breaking change (`/api/v2` additive).
- Re-assignment after revoke creates a new lineage task (ADR-0055) with no events → correctly re-appears as
  To-Export for the new assignee; revoked-after-export rows stay visible (status column) in Exported.
- PII (applicant name/PAN/mobile/address) leaves in the verifier's file — **owner-accepted 2026-07-02**,
  recorded in `docs/COMPLIANCE_GAPS_REGISTRY.md` §KYC-EXPORT-2026-07-02 (extends the ADR-0084 acceptance).
- Deferred (registry): mobile down-sync `visit_type <> 'OFFICE'` defense-in-depth predicate (ADR-0025 carry-over);
  ops-facing exported indicator beyond the case-detail chip; async ≥10k export tier (same deferral as ADR-0084).
