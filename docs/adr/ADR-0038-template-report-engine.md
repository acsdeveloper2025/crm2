# ADR-0038: Auto Template-Report Engine (FIELD_REPORT + CASE_REPORT)

- **Status:** Proposed (design only — engine NOT built; next slice)
- **Date:** 2026-06-16
- **Refines:** ADR-0037 (report_layouts config engine), ADR-0015 (reporting engine).
- **Reference impl (v1):** `CRM-BACKEND/src/services/TemplateReportService.ts` + `reportTemplateRenderer.ts` + `controllers/templateReportsController.ts`.

## Context
v1 auto-generates a verification report from the field agent's submitted form: pick a template by
**(verificationType × outcome)**, substitute `{Field_Name}` placeholders with the submitted form
values, clean whitespace → a narrative remark. ~180 templates, **hardcoded in code** (v1's #1 scaling
weakness — no per-client/product, no versioning, a 480-line outcome-string parser). PDF via Handlebars
+ Puppeteer. v2 has the *input* already: the device form lands in **`case_tasks.form_data[formType]`**
(slice 2c-2b; 9 form slugs; the device `verificationOutcome` rides along as evidence). Missing: the
template store + the parse/render + the surfaces. The case-detail page now has the **#6 Field Report**
and **#9 Client Report** cards as placeholders awaiting this engine.

## Decision (to build next slice)
1. **Config-driven, NOT hardcoded.** Reuse the **`report_layouts`** engine (ADR-0037) with two new kinds:
   - **`FIELD_REPORT`** — the per-task narrative (the #6 card content), keyed per **(client, product, verificationType[, outcome])**.
   - **`CASE_REPORT`** — the client-facing case report (the #9 download), per (client, product).
   Templates are **config rows**, editable per client+product — fixes v1's hardcoding. OCC + immutable-once-used (like data-entry).
2. **Syntax = Handlebars `{{field}}` + conditionals** (`{{#if}}`/`{{#eq}}`). Handlebars is already a v1 dep (`reportTemplateRenderer`). Conditionals collapse v1's ~180 type×outcome templates to **~9** (one per type; outcome drives the branches) — far less duplication than v1's flat per-outcome templates.
3. **Placeholders bind to the submitted form** via the existing SOURCE_CATALOG **`FORM_DATA_PATH`** (json-path into `case_tasks.form_data`) + case/applicant context (CASE_FIELD/APPLICANT_FIELD). One render service `(template, form_data, context) → narrative`; port v1's substitute + whitespace-collapse.
4. **Render on-demand** (v1 parity — not auto on submit). #6 renders the active FIELD_REPORT against each task's `form_data`; #9 renders CASE_REPORT → **PDF/Word/Excel** (Puppeteer / docx / exceljs).
5. **Seed v1's ~180 templates as config rows** so content isn't lost; they become per-client editable.

## ⭐ KYC extension (owner directive 2026-06-16 — resolve WHEN building this engine)
Template-report generation is currently **FIELD-task only**. KYC tasks must ALSO auto-generate a report.
**OPEN:** how does the BE auto-generate a KYC report from the data it receives from sources? Specifically
— do KYC verifiers **fill some fields** (a keyed KYC input set), and the system auto-generates the report
for the **document they're verifying** (a KYC FIELD_REPORT template per KYC document/verification type,
fed by those keyed fields)? Decide the KYC input source (keyed fields vs source-derived) + the KYC
template set as part of this engine build. The engine's (client, product, verificationType) keying should
extend to KYC verification types without schema change.

## Consequences
- One config-driven engine serves field narrative (#6), client report (#9), and KYC reports — no
  per-bank hardcoding; new client+product+vtype is configured from the FE Layout Designer.
- Avoid v1's pitfalls: DB-stored versioned templates; enum/config outcome routing (no string-parsing);
  a form-field catalog so templates validate against known fields; output-encode stored values
  (CSV formula-injection already handled by toCsv; HTML/PDF escape) + APPLICANT_FIELD PII scope.
- Defers: the renderers (PDF/Word/Excel) are their own work; #6/#9 cards stay placeholders until then.
