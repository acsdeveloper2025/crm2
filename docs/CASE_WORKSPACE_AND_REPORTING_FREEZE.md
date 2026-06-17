# Case Workspace & Reporting — Design Freeze (2026-06-05)

**Status:** FROZEN (design). Source of truth for the operations Case Workspace and the
per-client+product template/reporting engine. Derived from the live Zion `NewDataQC` work
surface + the RTRONS FI/RCU brochure (`Broucher FI.pdf`, the same product family CRM2 uses).
Binds ADR-0015. Build is DEFERRED (operations phase); this is the contract the build follows.

> **Adopt the UX and model, not the platform.** Zion is ASP.NET WebForms; we replicate the
> single-page work surface + the config-driven per-client+product reporting on the frozen v2
> stack (ADR-0001..0019).

---

## 1. The Case Workspace is ONE page (Zion NewDataQC)

Everything from assignment to report generation happens on a single, top-to-bottom,
save-gated page — no wizard, no scatter across routes. Reuses `/cases/:id` (the case detail
already built) promoted into the full workspace behind a feature flag (ADR-0009 pattern).

**Page layout (top → bottom):**
1. **Case header** — case number, client + product, **applicants + co-applicants**, status,
   dedupe decision + rationale, TAT clock. (Built.)
2. **Documents / Tasks list** — every `case_task` (verification unit instance). (Built.)
3. **Per-task block** — repeated for EACH task/document, each self-contained with:
   - **a. Data-entry / MIS fields** — the *configured* billing-MIS field set for this
     **client + product (+ verification type)** relationship. These are the fields that feed
     the Excel MIS (the "important fields for billing MIS"). Config-driven, not hardcoded.
   - **b. Assignment** — assign the task to a field/KYC executive; visit type (SITE / NO_VISIT
     i.e. desk), LOCAL / OGL distance band, **bill count** (e.g. `1-SITE & 1-MIS`) which drives
     billing/commission.
   - **c. Images from the field mobile app** — geo-tagged, watermarked photos received from the
     FE mobile app; option to view/show per task. (Object store; never re-compressed.)
   - **d. Data from the field mobile app** — the verification form data the field exec submitted
     from the mobile app, shown inline per task.
   - **e. Report entry** — per-task report fields (remark rich-text, door type, person met,
     status, etc.) — authored by the back-office reviewer.
   - **f. Auto-generated report from FE data** — the report body auto-populated from the
     mobile-app submission (d) + images (c) + entry (e), per the configured template.
   - **g. Per-task report download** — **Word / Excel / PDF** for that task/document.
4. **Footer** — **Final Status** (one official result) + **Case Report** (generate the sealed
   client report). Save-gated: cannot complete until required tasks are saved.

**Invariants kept:** ADR-0002 Case→Task→VerificationUnit; the FE/field result is evidence, the
back-office reviewer records the official result; RBAC + scope; append-only audit.

---

## 2. Per-client+product Template & Reporting Engine (the 200+ formats)

CRM2 (and Zion) maintain **200+ report/MIS formats**, one design per **client + product**
(sometimes per verification type). This is config-driven and **administered**, never hardcoded.
The existing Report Templates admin (migration 0008, `report_templates` keyed only by
`template_type`) is **superseded** by this richer model (ADR-0015).

### 2.1 Two template KINDS (both per client+product[+type])
- **MIS template (Excel)** — the column schema + mapping for the downloadable **Excel MIS**
  (billing/operational; e.g. the bank's 95-column format, portfolio-wise monthly + annexure).
  Columns map to: case fields, applicant fields, per-task data-entry/MIS fields (1.3a),
  assignment/bill-count fields, TAT, status.
- **Case Report template (PDF, primary; also Word/Excel)** — the **actual verification report**:
  header + applicant/co-applicants + per-document remarks + auto-generated body from FE mobile
  data + **embedded mobile-app images** + agency **seal + logo** + named verifier. This is the
  client deliverable.

### 2.2 Admin "Template Designer" (Administration → Templates, extended)
An admin screen to **design/upload a template for a (client, product[, verification type])**
relationship, for BOTH kinds above:
- Choose scope: client + product (+ optional verification type / unit).
- Choose kind: `MIS_EXCEL` or `CASE_REPORT`.
- Choose output formats: PDF / WORD / EXCEL (case report ⇒ PDF primary; MIS ⇒ Excel).
- Define the layout/columns + **field mapping** to data sources: case · applicants · task
  data-entry/MIS fields · assignment/bill-count · FE mobile form data · FE mobile images · seal/logo.
- Versioned + activate/deactivate; immutable once used by a generated report (audit).
- **Seedable**: the user already holds all existing MIS + PDF + Word + Excel formats — import
  them as the initial template set (import-engine, B-14).

### 2.3 Resolution
At report time, resolve the template by **client + product (+ verification type)** with a
sensible fallback (product-level → client-level → default). Pairs with CPV (the client+product+
unit enablement already built) — the report/MIS template hangs off the same relationship.

---

## 3. Data sources (frozen)
A template field/column may bind to any of: `cases` · `case_applicants` · `case_tasks` +
per-task **data-entry/MIS fields** · assignment + **bill-count** · **FE mobile form data** ·
**FE mobile images** (object store) · TAT/status · client/product/verification-unit metadata ·
agency seal/logo. No report content is hardcoded per client — everything flows from the template.

---

## 4. Build sequencing (DEFERRED — operations phase)
1. Task **Assignment** (assign `case_tasks`, visit-type, bill-count). 
2. **Verification Workspace** (single page §1) — reuse `/cases/:id` behind a flag; per-task
   data-entry + FE-mobile data/images + report entry + auto-gen + Final Status.
3. **Reporting/Template engine** (§2) — extend `report_templates` per ADR-0015: scope
   (client+product[+type]), kind (MIS_EXCEL | CASE_REPORT), formats (PDF/WORD/EXCEL), field/
   column mapping; the admin Template Designer; generation workers (PDF via the report-worker,
   Excel via the export engine; ≥10k or >8s = background job per the pagination/export freezes).
4. **MIS & Billing** (Excel MIS from MIS templates; bill-count → billing/commission).
5. Field **mobile app** integration (`/api/v2`, ADR-0012; data + images feed §1c/d).

Honor: pagination/DataGrid freeze (lists), import/export freeze (Excel/PDF via the export engine
+ import-engine for seeding the 200+ formats), background-job freeze (generation/export),
object-store for images, audit-chain for generated reports.

---

## 5. Relationship to existing freezes
- **Supersedes** the narrow Report Templates model (0008, type-only) → ADR-0015. The 0008 table
  is extended (scope + kind + formats + mapping), not discarded.
- **Extends** ADR-0010 (reporting strategy: `v_`/`mv_` for MIS reads; config-engine for case
  reports), DATAGRID/PAGINATION/IMPORT-EXPORT freezes, ADR-0012 (mobile as data source).
- Registered: FROZEN_DECISIONS_REGISTRY (#28), COMPLIANCE_GAPS (B-17 workspace, B-18 template
  engine, B-19 MIS), MASTER_MEMORY §3 + §8, PROJECT_INDEX.
