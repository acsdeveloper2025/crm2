# ADR-0037: MIS Layout Engine — per-(client,product) config for data-entry, MIS & Billing MIS

- **Status:** SUPERSEDED by [ADR-0083](ADR-0083-remove-mis-report-layout-engine.md) (2026-07-01) — the
  whole MIS / report-layout / office data-entry engine was removed (tables dropped in mig 0108) for a
  clean-slate rebuild; field/case report rendering was decoupled onto built-in defaults. Historical only.
- **Status (original):** Accepted
- **Date:** 2026-06-16
- **Realizes / refines:** ADR-0015 (config-driven per-client+product reporting engine). ADR-0015 named
  two kinds `MIS_EXCEL` + `CASE_REPORT`; this ADR refines the MIS side into **three kinds**
  (`DATA_ENTRY`, `MIS`, `BILLING_MIS`) and defers `CASE_REPORT` (the verification PDF).
- **Builds on:** ADR-0010 (reporting via `v_`/`mv_`), ADR-0036 (rates/commission amount sources),
  CPV catalog (client_products), the export engine (platform/export).
- **Spec:** `docs/specs/2026-06-16-mis-engine-design.md`.

## Context
The owner wants v2 to generate, per (client, product), a configurable **operational MIS** and a
**Billing MIS** (separate report types), fed by an office **data-entry** step — all set up from the
frontend when a new client+product onboards (no code), and with **no GST / no invoice / no payout**.
Zion hardcodes one bank's 95-column MIS (its #1 scaling weakness); v1 has a per-(client,product)
config-driven Data Entry MIS (`case_data_templates`/`case_data_template_fields`) but no Billing MIS
and a hardcoded operational MIS. v2 should generalize the v1 config pattern to all three kinds.

## Decision
1. **A dedicated layout-config pair, NOT an extension of `report_templates` (mig 0008).** ADR-0015 §3
   proposed extending the 0008 table; we instead add a clean `report_layouts` + `report_layout_columns`
   pair. Rationale: 0008's `report_templates` is the narrative-PDF (FIELD_NARRATIVE/KYC_DOCUMENT) engine
   keyed by type with a `content` blob; the MIS layouts are a structured, ordered, source-bound column
   model — overloading one table muddies both. `report_templates` stays for the deferred CASE_REPORT
   kind. (Deviation from ADR-0015 §3; 0015 was Accepted-but-unbuilt, so this is implementation
   evolution, not a frozen-decision reopen.)
2. **`report_layouts`** = one header per (client_id, product_id, kind) where kind ∈
   {`DATA_ENTRY`, `MIS`, `BILLING_MIS`}; **exactly one ACTIVE layout per (client,product,kind)**
   (partial-unique index). OCC `version` (ADR-0019). Layouts are selected by "the active one for this
   CPV+kind" — NOT temporally resolved like rates, so **no effective-dating** (simpler than 0036).
3. **`report_layout_columns`** = the ordered column/field definitions. Each column declares a
   `source_type` from a fixed enum and a `source_ref` that binds it to a real data source. A
   **code-defined source catalog** (shared via `@crm2/sdk`) is the allow-list: for the fixed-field
   source types (`TASK_FIELD`/`CASE_FIELD`/`APPLICANT_FIELD`) the `source_ref` MUST be a known field;
   `RATE_AMOUNT`/`COMMISSION_AMOUNT`/`TAT` carry no ref (the type IS the source); `DATA_ENTRY_FIELD`/
   `FORM_DATA_PATH`/`DOC_TYPE_COUNT`/`COMPUTED` carry a free ref validated at their consuming slice.
   For `DATA_ENTRY` layouts the columns ARE the operator form fields (`is_required`/`section`/`options`/
   `validation` apply); for `MIS`/`BILLING_MIS` they are output columns that bind to sources (including
   `DATA_ENTRY_FIELD` → an operator-keyed value — this is how data-entry fields feed the Billing MIS).
4. **MIS layouts are INDEPENDENT of the data-entry layout** (unlike v1, which derives MIS columns 1:1
   from the data-entry template) — an MIS/Billing-MIS can subset/reorder/add computed & amount columns.
5. **RBAC:** layout config CRUD reuses the existing `report_template.manage` perm (SUPER_ADMIN; admin
   template management). No new permission in this slice. The office data-entry write perm
   (`data_entry.manage`) and the MIS-generation perms come in their slices; Billing-MIS amounts stay
   `billing.view`-gated (the 5a/5b/5d comp-data rule).
6. **Generation** (later slices) reads via `v_`/`mv_` (ADR-0010) and builds the export ExportColumn
   manifest DYNAMICALLY from the active layout's columns → the existing export engine. No GST/invoice.

## Consequences
- A new client+product is fully configured from the FE Layout Designer (slice 2), cloning v1's proven
  `CaseDataTemplatesPage` field-builder + source-binding + Excel-import patterns.
- The source catalog is the single contract between "what a column can bind to" and "what the read-model
  can resolve" — both API validation and FE dropdowns consume it; extending a source means one edit.
- Versioning is is_active-based (old versions kept as inactive rows); true immutable-once-used
  enforcement for `DATA_ENTRY` layouts (cases hold keyed data) lands with the data-entry slice.
- Defers: the Layout Designer FE (slice 2), office data-entry + `case_data_entries` (slice 3),
  MIS/Billing-MIS generation + `v_mis_rows` (slices 4–5), loading the real bank format (slice 6).

## Correction — 2026-06-16: office data-entry grain is per-CASE, not per-task
Slice 3a/3b initially keyed `case_data_entries` per **task** (`uq(task_id)`, `/data-entry/tasks/:taskId`).
The owner corrected this against the Zion architecture: **`NewDataQC` keys the structured MIS / billing-MIS
fields once PER CASE** (the documents/verifications are a grid within the one case page), and the MIS
layout grain is per (client,product) — a case has exactly one (client,product), so the active
`DATA_ENTRY` layout resolves cleanly per case. Re-grained (mig 0062, no prod v2 DB — test data only):
`case_data_entries` now `uq(case_id)` (FK `cases`), `GET/PUT /api/v2/data-entry/cases/:caseId`,
case-scope-guarded (404 IDOR-safe), SDK type `CaseDataEntry`. The immutable-once-used guard is unchanged
(keys off `layout_id`). The FE is one **per-case** Data Entry section on the case detail (not a per-task
action). Supersedes the slice-3a "one record per task" line.
