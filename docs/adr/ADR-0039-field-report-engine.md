# ADR-0039: FIELD_REPORT Engine (template-report slice 1)

- **Status:** Accepted (built — template-report engine slice 1, 2026-06-16)
- **Date:** 2026-06-16
- **Implements:** ADR-0038 (auto template-report engine), for FIELD tasks. Refines ADR-0037 (report_layouts).
- **Reference impl (v1):** `CRM-BACKEND/src/services/TemplateReportService.ts` (~180 hardcoded templates).

## Context
ADR-0038 locked the engine direction (config-driven, Handlebars, reuse `report_layouts`, two new kinds
`FIELD_REPORT`/`CASE_REPORT`, on-demand render, KYC open). This ADR records the concrete slice-1 build:
the **FIELD_REPORT** kind + the render engine + the per-task read used by the case-detail #6 card. The
input already exists in `case_tasks.form_data` (the device's submitted verification form, 9 slugs).

## Decisions

1. **Storage = extend `report_layouts`** (honoring ADR-0038's "reuse the engine"). Migration 0064 adds:
   - `template_body text` — the Handlebars narrative source (required for FIELD_REPORT, null otherwise).
   - `verification_type varchar(64)` — the per-type key = the **field unit code** (e.g. `RESIDENCE`); a
     **free string, not enum-constrained**, so the engine extends to KYC verification types later with
     **no schema change** (ADR-0038). Required for FIELD_REPORT, null otherwise.
   - Active-unique widened to `(client_id, product_id, kind, COALESCE(verification_type,'')) WHERE
     is_active` — preserves one-active per (client,product,kind) for the type-less kinds (vt='') AND
     allows one active FIELD_REPORT **per verification type**.
   - A `CASE WHEN` coherence CHECK: FIELD_REPORT ⟺ (verification_type IS NOT NULL AND template_body IS
     NOT NULL); the other kinds carry neither.

2. **Columns are the VARIABLE CATALOG** (fixes v1's #1 weakness — no field validation). Each
   `report_layout_column` of a FIELD_REPORT layout declares one Handlebars variable: `column_key` = the
   `{{var}}` name, source-bound via the existing `SOURCE_CATALOG` (`FORM_DATA_PATH` json-path into
   `form_data`, plus `TASK_FIELD`/`CASE_FIELD`/`APPLICANT_FIELD`). The render service resolves the
   declared columns into a context, then runs `template_body` against it.

3. **Syntax = Handlebars** (`handlebars` npm dep). `{{var}}` values are HTML-escaped by default
   (output-encoding); an `{{#eq}}` helper (block + subexpression) drives outcome branching inside one
   template per verification type — collapsing v1's ~180 type×outcome templates toward ~9.

4. **Render on-demand**, read-only: `GET /api/v2/cases/:id/tasks/:taskId/field-report` (gated
   `case.view`, **case-scope-guarded → 404 IDOR-safe**) returns `FieldReportView{ taskId,
   verificationType, layoutId, layoutName, narrative }`. `narrative` is **null** when no FIELD_REPORT is
   configured for that verification type — a normal 200 (like a missing DATA_ENTRY layout).

5. **Security:** template bodies are admin-authored (`report_template.manage`, SUPER_ADMIN); json-paths
   are walked by **plain property access only** (param-bound, never eval/interpolated); Handlebars proto
   access is disabled; the whole render context is loaded under the case scope, so `APPLICANT_FIELD` PII
   inherits case scope + perm.

## KYC — DEFERRED (owner decision 2026-06-16)
Owner chose to **defer KYC report generation entirely**: build FIELD_REPORT for field tasks now; KYC
report-gen is a later epic. The `verification_type` free-string key + the `report_template_type`
(FIELD_NARRATIVE/KYC_DOCUMENT) seam already on `verification_units` mean KYC extends later without a
schema change (a KYC FIELD_REPORT keyed by the KYC unit code, fed by a future KYC-keyed input surface).

## Deep v1 audit — captured requirements (2026-06-16)
Backing evidence: **`docs/specs/2026-06-16-field-report-v1-audit.md`** (three parallel read-only audits
of CRM-BACKEND / CRM-FRONTEND / crm-mobile-native, with file:line). The owner requires v2 to capture
three things v1 does that S1 alone does not. They are recorded here as locked design intent for S2–S5.

### R1 — the field report shows BOTH raw fields AND the narrative (not narrative-only)
v1's `OptimizedFormSubmissionViewer.tsx` renders, on one screen: header summary → **raw submitted form
fields (sectioned `Label: value`)** → **photos (geo-captioned)** → **generated narrative**
(`TemplateReportCard`). **Decision:** the v2 **#6 Field Report card** is this COMBINED view (per-task
accordion), not just the narrative S1 returns. Raw fields are rendered by **introspecting
`case_tasks.form_data`** (generic camelCase→Title-Case, section-bucketed) exactly like v1's
`createComprehensiveFormSections` — NOT per-type React layouts, NOT a hardcoded schema. Each verification
type captures different fields (~30–50% type-specific over a shared address/TPC spine); generic
introspection handles all 9 without per-type code.

### R2 — the generation LOGIC (derived "smart" placeholders), config-driven
v1's narrative engine (`TemplateReportService.ts`) is plain `{Field}` regex substitution + **~30 JS
helper closures** that pre-bake derived clauses (often `''`), then a **whitespace-collapse pass** removes
the gaps. The logic families v2 must support: value transforms (ordinal, sentence-casing lc/capFirst,
period pluralization, **local-date** formatting [never UTC], area "N sq. feet"), all-or-nothing composite
sentences (working-profile, current-company-operating), enum→prose mappers (call-remark, document-shown,
dominated-area, political-connection, nameplate sighted/not, met-person-confirmation), graceful TPC joins
(no dangling " and "), and the **APF verdict-coherence** sentences (reconcile agent verdict vs
construction reality). **Decisions:**
- Outcome drives branching via `{{#eq outcome "…"}}` — **one template per type with conditionals**
  (collapses v1's ~180 flat (type×outcome) templates to ~9). The device `verificationOutcome` (in
  `form_data`) is the key; v2 does **not** re-parse prose (v1's ~480-line `getTemplateKey` + the IST/`Open`
  vs `Opened`/`ert`-substring bugs are NOT carried). A small config normalizer maps the device outcome
  string → a stable token.
- S1 already ships `{{#eq}}`, HTML-escape, proto-off, and the whitespace-collapse pass. The remaining
  ~30 helpers ship as a **versioned Handlebars helper library** (S3), plus a **`COMPUTED` catalog source**
  for the multi-field composites (the slice-1 SOURCE carry). Templates live in `report_layouts` (config,
  editable) — fixing v1's hardcoded-TS, deploy-to-edit weakness.

### R3 — per-photo reverse-geocoded address + capture details
v1 architecture inverted 2026-05-31: the phone saves **RAW geotagged JPEGs** (capture stays fast/offline,
never blocks on geocoding); the **reverse-geocoded address is resolved server-side (Google), frozen in a
column, and shown as a CAPTION below each image** (address + GPS `toFixed(6)` + accuracy ±Nm + capture
time + photoType; optional altitude/speed/heading + maps link) — **never burned into pixels**. Reverse
geocode runs **async-on-upload** (BullMQ), write-once-then-frozen, with an on-view fallback + DLQ.
**Decisions:**
- v2 persists the full `geoLocation` jsonb (lat/lng/accuracy/altitude/speed/heading/timestamp) +
  a `reverse_geocoded_address` column, resolved async-on-upload and **frozen** (v2 has Valkey + jobs +
  a geocode module to reuse). The #7 Field Photos gallery gains the geo caption; the #6/#9 report photo
  context gains `reverseGeocodedAddress` — **closing a gap v1 itself never closed** (v1's sealed-report
  photo context has no address). This is an INGEST-side slice (S4), tied to the field-submission ingest.
- Preserve the rule: **mobile must NOT reverse-geocode at capture** (explicit v1 directive).

## Consequences & slice plan (post-audit)
- One config-driven Handlebars engine serves the #6 narrative (FIELD_REPORT) and later the #9 client
  report (CASE_REPORT) — no per-bank hardcoding; new client+product+type configured from the FE designer.
- The FE column-Designer **excludes FIELD_REPORT** until S2 adds the narrative-body designer.
- **S1 (DONE, `863b19e`):** engine — config templates, `{{#eq}}` + escape + whitespace-collapse, per-task
  render endpoint, narrative only.
- **S2:** FE Field Report designer + wire the **#6 card as the R1 COMBINED view** (raw fields + photos +
  narrative); add `verificationType` to `/by-config`; promote `findActiveByConfig` to a platform helper
  (2nd-consumer ratchet due).
- **S3:** the R2 Handlebars **helper library** + `COMPUTED` catalog source; seed v1's templates as ~9
  per-type config rows with outcome conditionals. **Exact source data = `2026-06-16-v1-report-mapping.md`**
  (prod-verified: the 9 types × their field keys [`v1-ground-truth/field-keys-by-type.tsv`], the 66-combo
  (type×outcome) matrix, the 6-section template skeleton, and the field→placeholder + grammar-helper map).
- **S4:** the R3 **photo reverse-geocode** (async-on-upload + frozen column + #7 caption + report photo
  context); tied to the field-submission ingest slice.
- **S5:** #9 **CASE_REPORT** + PDF/Word/Excel renderers (v1 System-B parity: branding, photos, tables).
- **Deferred:** KYC report-gen epic.
