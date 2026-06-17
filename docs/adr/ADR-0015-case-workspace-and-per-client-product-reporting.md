# ADR-0015: Case Workspace (single page) & per-client+product Reporting Engine

- **Status:** Accepted
- **Date:** 2026-06-05
- **Supersedes:** the narrow Report Templates model (migration 0008 — `report_templates` keyed
  only by `template_type`). Extends ADR-0010 (reporting strategy) and ADR-0012 (mobile data source).

## Context

The operations heart of the FI/RCU domain (Zion `NewDataQC`, RTRONS FI/RCU brochure — the same
product family CRM2 runs) is a **single-page case work surface** plus a **config-driven reporting
engine with 200+ formats, one design per client+product**. The owner directed that v2 replicate
this exactly and fold it into the design freeze:

- One page covers, per document/task: data-entry (billing-MIS fields) · assignment · field
  mobile-app images · field mobile-app data · report entry · auto-generated report from FE data ·
  per-task Word/Excel/PDF download. Footer: one Final Status + the sealed Case Report.
- Reporting is **two kinds**, both per **client + product (+ verification type)**: an **MIS report**
  (Excel, billing/operational columns — e.g. the bank 95-column format) and a **Case Report** (the
  actual verification PDF: remarks + auto-gen from FE data + embedded mobile images + agency seal/
  logo; also Word/Excel).
- An **Administration Template Designer** lets staff design/upload these per client+product; the
  owner already holds all existing formats to seed.

The v2 Report Templates module shipped (0008) keyed templates only by `FIELD_NARRATIVE`/
`KYC_DOCUMENT`. That is too narrow for 200+ per-client+product formats and two kinds.

## Decision

1. **Case Workspace is one page** (reuse `/cases/:id` behind a feature flag, ADR-0009): per-task
   data-entry/MIS fields · assignment (visit-type, LOCAL/OGL, bill-count) · FE mobile images ·
   FE mobile data · report entry · auto-generated report · per-task PDF/Word/Excel; footer Final
   Status + Case Report. Save-gated. (Full layout: `docs/CASE_WORKSPACE_AND_REPORTING_FREEZE.md`.)
2. **Reporting is a config-driven per-(client, product[, verification type]) template engine** with
   two **kinds** — `MIS_EXCEL` and `CASE_REPORT` — each with output **formats** (PDF/WORD/EXCEL) and
   an explicit **field/column mapping** to data sources (case, applicants, task data-entry/MIS
   fields, assignment/bill-count, FE mobile data, FE mobile images, seal/logo, TAT/status).
3. **The 0008 `report_templates` table is extended** (scope: client+product[+type]; kind; formats;
   mapping; versioned + immutable-once-used), not replaced wholesale. No hardcoded per-client report
   content anywhere.
4. **Generation = background jobs**: PDF via the report-worker, Excel/MIS via the export engine
   (pagination/export/background-job freezes). Seeding the 200+ formats = the import-engine.
5. **MIS reads** use `v_`/`mv_` per ADR-0010; the MIS template maps internal columns → the per-client
   column schema.

## Consequences

### Positive
- Operator finishes a case on one coherent page (Zion's proven UX); one official result.
- 200+ formats are configuration owned by Admin, not code — onboard a new bank without a deploy.
- Reporting hangs off the same client+product (+CPV) relationship as rates/units — coherent SoT.

### Negative
- Larger template schema + a template-designer UI + generation workers — a substantial build
  (deferred, sequenced in the freeze doc).
- Field-mapping flexibility needs guardrails (validation, versioning, audit) to stay maintainable.

## Alternatives Considered
- **Keep type-only templates (0008 as-is)** — rejected: cannot express 200+ per-client+product
  formats or the MIS-vs-case-report split the domain requires.
- **Hardcode per-client formats in code** (v1 `TemplateReportService`) — rejected: a deploy per
  bank; the whole point is config-driven onboarding.
- **Multi-page wizard for the work surface** — rejected: the domain operates daily *because* it is
  one save-gated page; scattering it adds context-switching.

## Related ADRs
- ADR-0002 (Case→Task→VerificationUnit), ADR-0009 (feature flags — workspace behind a flag),
  ADR-0010 (reporting strategy — extended), ADR-0012 (mobile as a data source), ADR-0014 (auth).
- Companion freeze: `docs/CASE_WORKSPACE_AND_REPORTING_FREEZE.md`.
