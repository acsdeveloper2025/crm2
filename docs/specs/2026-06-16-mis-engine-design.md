# MIS Engine — config-driven office data-entry + operational MIS + Billing MIS (per client+product)

- **Date:** 2026-06-16
- **Status:** DRAFT — owner-steered, awaiting go-ahead to build
- **Realizes:** ADR-0015 (config-driven per-client+product reporting engine) — the **MIS side**; defers
  the `CASE_REPORT` PDF kind. New **ADR-0037** to lock the data-entry + MIS/Billing-MIS specifics.
- **Extends:** ADR-0010 (reporting via `v_`/`mv_`), ADR-0036 (billing/commission — the rates +
  commission_rates amount sources), the CPV catalog (mig 0001/0002), the export engine (platform/export).
- **Explicitly NOT in scope:** GST, invoice generation, invoice PDF, payout runs. (Owner: "we don't
  want gst and all". Zion + v1 confirm billing-as-MIS-export is the real operational need.)

## Owner decisions (2026-06-16)
1. **Full office data-entry screen** — a dedicated keying surface (Zion `NewDataQC` / v1
   `case_data_entries` style) where an office operator enters the structured MIS fields per case/task.
2. **Config engine first** — build the per-CPV column-config table + admin designer first, then
   configure each client (vs. hardcoding one bank's format).
3. **Owner supplies the real sample** — the actual MIS + Billing-MIS column lists come from the
   owner's live bank format and load as **config rows** (the engine is format-agnostic, so slices 1–2
   do not need the sample).

## Grounding (research 2026-06-16)
- **Zion (reference):** data entry is a separate OFFICE step (field app = photos/narrative only; office
  keys structured fields + result). MIS = a hardcoded ~95-column Excel (Company+date). **Billing MIS =
  a SEPARATE screen** (Portfolio + branch multi-select + date), billing derived inline from visit
  type/distance(LOCAL/OGL)/BILL=Y/N + counts. No invoices, no GST. Per-client/product = hardcoded
  portfolios (its #1 scaling weakness).
- **v1 prior art:** the reusable pattern is **Data Entry MIS** — `case_data_templates` +
  `case_data_template_fields` keyed by **(client_id, product_id)**, config-driven typed columns
  (key/label/type/required/order/section/options/prefill); values in `case_data_entries.data` jsonb.
  v1's operational MIS is hardcoded 35-col; v1 "billing" = the GST invoices subsystem (skip).
- **v2 current:** MIS not built. Spine ready — `client_products` + CPV catalog + `rates` +
  `commission_rates`; the **export engine** (`platform/export`: ExportColumn→CSV/XLSX + background
  jobs + storage) is reusable. The **billing-MIS data-entry fields already exist as typed columns** on
  `case_tasks` (`visit_type`, `distance_band`, `bill_count`, `verification_outcome`, `remark`,
  `completed_at` → TAT, `task_origin`). `report_templates` (mig 0008) is type-only (no
  client/product/kind/mapping) — ADR-0015 §3 says extend it.

## Architecture

### A. Config model (3 template kinds, all per client+product, versioned, immutable-once-used)
- **`DATA_ENTRY`** — the office keying form schema (which fields operators fill per case/task).
- **`MIS`** — the operational MIS column layout (Excel output).
- **`BILLING_MIS`** — the billing MIS column layout (Excel output; adds rate/amount + branch axis).

Schema (new migration; extends the 0008 model per ADR-0015 §3 — keep 0008's `FIELD_NARRATIVE`/
`KYC_DOCUMENT` rows untouched, add scope+kind for the new rows OR a clean dedicated pair — decide in
ADR-0037; leaning **dedicated pair** to avoid overloading the narrative-report table):

```
report_layouts            -- the per-CPV template header
  id, client_id FK, product_id FK,
  kind          CHECK IN ('DATA_ENTRY','MIS','BILLING_MIS'),
  name, version int, is_active bool,
  effective_from/to, audit cols
  -- one ACTIVE layout per (client_id, product_id, kind); revise = end-date old + insert new (OCC)

report_layout_columns     -- ordered column / field definitions
  id, layout_id FK,
  column_key, header_label,
  source_type   CHECK IN ('TASK_FIELD','CASE_FIELD','APPLICANT_FIELD',
                          'RATE_AMOUNT','COMMISSION_AMOUNT','TAT','DATA_ENTRY_FIELD',
                          'FORM_DATA_PATH','DOC_TYPE_COUNT','COMPUTED'),
  source_ref    -- the typed column name / json-path / data-entry field key / doc-type code
  data_type     CHECK IN ('TEXT','NUMBER','DATE','SELECT','BOOLEAN'),
  display_order, section,
  is_required   bool,        -- DATA_ENTRY kind: required-to-key
  options jsonb, validation jsonb
```

For `DATA_ENTRY` layouts the columns ARE the operator form fields. For `MIS`/`BILLING_MIS` they are
the output columns, each mapping to a **bindable source** (incl. `DATA_ENTRY_FIELD` → an operator-keyed
value — this is how "data-entry fields feed the Billing MIS").

### A.1 v1 FE prior art (clone this — proven, owner wants FE-driven onboarding of new CPVs)
A new client+product is configured ENTIRELY from the frontend (no code), mirroring v1's two shipped
per-(client,product) designers:
- **`CRM-FRONTEND/src/pages/CaseDataTemplatesPage.tsx`** — the field builder to clone: add-field rows
  (label → auto-slug key, type dropdown TEXT/NUMBER/DATE/SELECT/MULTISELECT/BOOLEAN/TEXTAREA, section,
  required toggle, options editor, collapsible validation min/max/len/pattern), **cascading
  client→product** dropdowns (product disabled until client; locked/immutable once the template is
  created), and a **"Map to system field"** dropdown → this is the source-binding (§B). Backed by
  `src/constants/templateFieldPrefillCatalog.ts` (FE) mirroring `CRM-BACKEND/src/config/
  templateFieldPrefillCatalog.ts` (BE) — **exactly the §B catalog pattern; reuse the concept.**
- **`components/cases/TemplateImportDialog.tsx`** — Excel/CSV **parse→preview→save** (`POST
  /case-data-templates/parse-upload` parses without persisting → admin edits each parsed field →
  save). Reuse for seeding the owner's bank format into a layout.
- **`ReportTemplatesPage.tsx`** — per-CPV PDF authoring (the deferred CASE_REPORT kind; placeholder
  catalog = `reportContextSchema`).
- **RBAC pattern:** v1 gates writes on `case_data_template.manage` / `report_template.manage`
  (SUPER_ADMIN). v1 has a FE-nav-gate vs BE-write-gate MISMATCH (`page.settings` nav vs
  `case_data_template.manage` write) — **v2 must keep FE nav gate ≡ BE write gate** (server authoritative).

**Gaps v1 does NOT have → v2 builds fresh:** (1) a **Billing-MIS designer** (none in v1); (2) **MIS
columns independently designable** — v1 derives operational-MIS columns 1:1 from the data-entry
template, too rigid; v2's `MIS`/`BILLING_MIS` layouts are their OWN column sets (subset/reorder/computed/
amount columns) that BIND to data-entry fields + other sources; (3) **real drag-reorder** (v1's grip is
decorative; order = array position); (4) **config-level export/clone** of a layout between CPVs.

### B. Bindable source-field catalog (a static, code-defined registry — the allow-list)
Each `source_type` resolves against a known set so a layout can only bind real, scoped data:
- `TASK_FIELD`: task_number, status, visit_type, distance_band, bill_count, verification_outcome,
  remark, task_origin, priority, address, trigger, started_at, completed_at, assignee, area, pincode.
- `CASE_FIELD`: case_number, client, product, backend_contact, case verification_outcome/result_remark/
  completed_at, dedupe.
- `APPLICANT_FIELD`: name, mobile, pan, applicant_type, calling_code.
- `RATE_AMOUNT` / `COMMISSION_AMOUNT`: via the ADR-0036 shared laterals (rates ladder / commission).
- `TAT`: computed (completed_at − created_at), per the SLA bands.
- `DATA_ENTRY_FIELD`: an operator-keyed value from the active `DATA_ENTRY` layout (by field key).
- `FORM_DATA_PATH`: a JSON path into `case_tasks.form_data[<formType>]` (per-form; opaque — needs a path).
- `DOC_TYPE_COUNT`: the Zion-style per-document-type 0/1 count column (by doc-type/unit code).

### C. Office data-entry workflow (the keying screen)
- A new surface where an office operator, for a completed task (or case), fills the active `DATA_ENTRY`
  layout's fields for that CPV. Renders **dynamically** from the layout columns. Persists to a new
  `case_data_entries (case_id|task_id, layout_id, data jsonb, version, audit)` (v1 pattern).
- **Lifecycle placement (ADR-0037 decision):** data entry sits at the OFFICE/backend step — the same
  point where the backend user records the official result (ADR-0025/0032 D3 finalize). Proposal:
  **fold the data-entry form into the existing finalize/review surface** (one office step: key MIS
  fields + record result), NOT a brand-new lifecycle stage. Reuses RBAC + scope already there.
- RBAC: new perm `data_entry.manage` (office roles), default-deny + scope (404 IDOR-safe).

### D. Generation (operational MIS + Billing MIS)
- A `/mis` screen: pick client+product + kind (MIS | BILLING_MIS) + date range (+ **branch** axis for
  BILLING_MIS — Zion scopes billing by branch; confirm whether v2 has a branch dimension or uses
  client/location). Resolve the active layout → build an **ExportColumn[] manifest DYNAMICALLY** from
  its columns → run the read-model → export XLSX via the existing `platform/export` engine (+ the
  background-job offload for large exports, already built).
- Read-model per ADR-0010: a `v_mis_rows` view (completed tasks ⨝ case ⨝ CPV ⨝ data-entry values ⨝
  derived amounts), one row per task/document (Zion + v1 grain). Heavy aggregates → `mv_` later.
- RBAC: `mis.generate` (operational) / Billing MIS gated `billing.view` (comp data — the 5a/5b rule;
  amounts only to billing.view holders, consistent with slice 5d).

## Slices (config-engine-first)
1. **Config schema + module + source catalog.** `report_layouts` + `report_layout_columns` migration
   (triple-write) + the bindable-source registry + CRUD API (effective-dated + OCC, like rates/
   commission_rates) gated the EXISTING `report_template.manage` perm (SA-only admin; ADR-0037 §5 —
   no new permission). No generation yet.
2. **Admin Layout Designer (FE) — clone v1's `CaseDataTemplatesPage` field builder (§A.1).** Per-CPV
   layout builder: cascading client→product (locked once created) + kind (DATA_ENTRY|MIS|BILLING_MIS),
   add/**drag-order** columns, bind each to a source (dropdown from the §B catalog), required/section
   for DATA_ENTRY. Excel/CSV **import (parse→preview→save)** to seed the owner's format + a config
   **export/clone** to copy a layout to another CPV (both net-new vs v1). This is how a NEW client+product
   is onboarded from the frontend. Gated `report.template.manage` (admin) — FE nav gate ≡ BE write gate.
3. **Office data-entry screen.** Render the active `DATA_ENTRY` layout for a task at the finalize/office
   step; persist to `case_data_entries`; perm `data_entry.manage`. (ADR-0037 lifecycle placement.)
4. **Operational MIS generation.** `v_mis_rows` view + read-model + dynamic ExportColumn manifest →
   XLSX export; `/mis` screen (client/product/date filters). Reuse export engine + bg jobs.
5. **Billing MIS generation.** Add rate/commission/branch columns + the BILLING_MIS kind path; gated
   `billing.view`. The amount sources reuse the ADR-0036 laterals.
6. **Load the real bank format.** Import the owner's actual MIS + Billing-MIS column lists as layout
   config rows; validate end-to-end against a real completed case; iterate columns.

## Open items / awaiting input
- **The actual MIS + Billing-MIS column lists** (owner to supply) — drive slice 6; the engine (1–5) is
  format-agnostic and proceeds without them.
- **Branch axis for Billing MIS** — Zion scopes billing by bank branch (multi-select). Confirm whether
  v2 models branches (a location dimension?) or scopes by client/location. (ADR-0037.)
- **DATA_ENTRY vs existing typed fields** — visit_type/distance_band/bill_count/outcome/remark are
  already typed columns; the DATA_ENTRY layout should bind to those (not re-key them) and only add the
  genuinely-new operator fields. Decide the overlap when the sample lands.
- **Zion materials gap:** the exact Billing-MIS columns + the "data-entry details" field list were not
  in the captured Zion files (collapsed panel; only the op-MIS XLS supplied; 5 MP4s unviewable). The
  owner's sample resolves this.

## Don't-regress / invariants to honour
- Per-CPV layouts are config (effective-dated + OCC + immutable-once-used), like rates/commission_rates.
- Billing-MIS amounts are comp data → `billing.view` gate (the 5a/5b/5d rule); never exposed to
  case.view-only roles. Any MIS export carrying amounts gates on the resource perm, not just data.export.
- Reporting reads go through `v_`/`mv_` views, never inline ad-hoc SQL (ADR-0010).
- No GST, no invoice, no payout in this epic.
- Reuse the export engine (ExportColumn → CSV/XLSX + bg jobs) — only the manifest becomes dynamic.
