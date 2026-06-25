# ADR-0063 — Retire the Report Templates module (superseded by `report_layouts`)

**Status:** Accepted · **Owner-confirmed** (2026-06-25) · **Supersedes:** the 0008 reservation in
ADR-0037 §1 and the "extend 0008" plan in ADR-0015 §3 / `CASE_WORKSPACE_AND_REPORTING_FREEZE.md` §2.2.
**Migration:** `0091` (drops `report_templates`). **Closes/reconciles:** registry B-18 / B-19 (stale
"extends report_templates 0008" text) and the §H disposition for the Report Templates module.

## Context

The Report Templates module (`report_templates` table, mig `0008`; api `modules/reportTemplates/`; web
`features/templates/`; `/api/v2/report-templates`) was built in the Administration phase as the intended
authoring surface for report bodies "the report engine will later render" — keyed only by
`template_type ∈ {FIELD_NARRATIVE, KYC_DOCUMENT}` with a freeform `content` blob.

That render engine was never built on `report_templates`. The reporting design instead evolved onto a
separate, richer engine:

- **ADR-0015** + the reporting freeze superseded the type-only contract (one day after 0008 shipped),
  originally planning to *extend* the 0008 table.
- **ADR-0037 §1** reversed the extend-0008 plan: it built a clean `report_layouts` + `report_layout_columns`
  pair (per-(client,product), structured, source-bound columns), reserving 0008 only "for the deferred
  CASE_REPORT kind."
- **ADR-0039** (FIELD_REPORT, mig 0064) and **ADR-0041** (CASE_REPORT, mig 0066) built *both* kinds on
  `report_layouts`, dissolving even ADR-0037's leftover CASE_REPORT reservation.
- **ADR-0049** (MIS generation) reads the active `report_layouts` row.

As built at HEAD, the render engines (`fieldReports`, `caseReports`, `mis`, `caseDataEntries`) read only
`report_layouts`/`report_layout_columns`. **Nothing reads `report_templates`** — the repository documents
this itself (`hasDependents()` returns `false`, "No v2 table references report_templates yet"). The only
non-CRUD references are a system-health row count and an e2e seed row. An admin authoring a Report Template
today changes nothing in any report — an inert, misleading surface. A six-agent read-only investigation
(incl. an adversarial reader-hunt) confirmed zero downstream consumers.

## Decision

We will **retire the Report Templates module**: drop the `report_templates` table (mig `0091`), and remove
its api module, SDK client + contracts, web pages + route + nav entry, the `page.templates` (`TEMPLATE_VIEW`)
permission, its system-health count, and its e2e spec + seed row. `report_layouts` (ADR-0037/0039/0041/0049)
is the sole report-authoring/render surface going forward.

**Two shared artifacts are deliberately preserved** so the MIS Layout / Report Layout designer is wholly
unaffected:

1. **`report_template.manage` (`TEMPLATE_MANAGE`)** — this permission is the visibility + RBAC anchor for
   the Report Layouts designer (`modules/reportLayouts/routes.ts` gates *every* route on it; the "MIS
   Layouts" nav entry uses it). The permission **key is retained unchanged** (the live `role_permissions`
   data references the string `report_template.manage`; renaming it would be a breaking RBAC change). Only
   its `PERMISSION_META` label is updated from "Report Templates — Manage" to "MIS Layouts — Manage" to
   match what it now governs.
2. **`REPORT_TEMPLATE_TYPES` const** (`@crm2/sdk` `verificationUnit.ts`) and the
   `verification_units.report_template_type` column — these are the verification-unit registry's own
   FIELD_NARRATIVE/KYC_DOCUMENT classifier (a semantic enum value, **not** an FK to `report_templates`).
   They are untouched; removing the table orphans nothing.

Migration `0091` is `DROP TABLE IF EXISTS report_templates CASCADE`. It is **re-run-safe** under the
prod every-deploy re-apply model: 0008 (`CREATE TABLE IF NOT EXISTS`) → 0015/0017 (which reference the
table in their effective-from / OCC-audit trigger arrays) all run *before* 0091, so the table always
exists when earlier migrations touch it and is dropped last. Historical `audit_log` rows with
`entity_type='report_templates'` remain (append-only, no FK) as legitimate history.

## Consequences

### Positive

- Removes a misleading, inert authoring surface — no more authoring templates that nothing renders.
- One report-authoring engine (`report_layouts`), per the as-built reporting design (ADR-0037/0039/0041/0049).
- The Access Control matrix no longer advertises a dead "Report Templates" capability.
- Reconciles the stale registry B-18/B-19 "extends report_templates 0008" text with reality.

### Negative

- **`/api/v2` narrowing.** Removing `/api/v2/report-templates` and the `counts.reportTemplates` field from
  the admin-only System Health response is technically non-additive. This is consumer-safe: the only
  consumers are the admin web pages updated in lockstep; **the mobile `/api/v2` surface is not touched at
  all** (no mobile route/role references report_templates — verified). The `additive-only` rule protects
  consumers; here no live consumer breaks.
- The `report_template.manage` permission key now reads slightly off (it governs layouts, not templates).
  Renaming the key was rejected to avoid a breaking RBAC/data migration; the display label is corrected.

## Alternatives Considered

- **Keep but mark dormant** (leave the CRUD, add a "non-rendering" banner). Rejected by the owner: it
  leaves the footgun and the dead `/admin/templates` route in place.
- **Consolidate `report_templates` into `report_layouts`.** Rejected: nothing to fold — the `content`
  blob is inert, the schemas are incompatible (freeform blob vs. structured ordered columns), and
  `report_layouts` already covers FIELD_REPORT/CASE_REPORT. There is no live data worth migrating.
- **Leave the table, remove only the UI/API.** Rejected: a dead table is the cruft this change removes;
  the drop is re-run-safe and has zero data dependency (0 referrers).

## Related ADRs

- **ADR-0008** — design-system / Administration phase (origin of mig 0008).
- **ADR-0015** + `CASE_WORKSPACE_AND_REPORTING_FREEZE.md` — superseded the type-only contract.
- **ADR-0037 / ADR-0049** — MIS layout + generation engine (`report_layouts`); this supersedes 0037's
  0008 reservation.
- **ADR-0038 / ADR-0039 / ADR-0041** — template/field/case report engines, all built on `report_layouts`.
