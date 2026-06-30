# ADR-0079: FIELD_REPORT falls back to the standard built-in template when no layout is configured

- **Status:** Accepted
- **Date:** 2026-06-30
- **Relates to:** ADR-0039 (field-report engine), ADR-0057 (render-time canonicalization), ADR-0051/0063 (report layouts / template designer). No migration.
- **Extends:** ADR-0039 — adds an automatic fallback leg; does not change the engine, the schema, or the API contract.

## Context

On prod, the per-task FIELD_REPORT narrative was **never generated for any case** — e.g. CASE-000018 (RESIDENCE, outcome POSITIVE, a complete device submission with photos + all fields) returned `narrative: null`.

Root cause: `fieldReportService.render` rendered a narrative **only if** an admin had authored a `report_layouts` row for that exact `(client, product, verificationType, kind='FIELD_REPORT')`. The 9 standard templates (`FIELD_REPORT_DEFAULTS` — faithful ports of v1's `TemplateReportService` narratives, ADR-0039 S3) were offered in the designer as "Load standard template" but were **never used as a fallback by the API**. Prod has **zero** `report_layouts` configured → every task fell to the `narrative: null` branch.

This diverged from v1: `TemplateReportService` had built-in per-type narratives and **always** generated the report from `(type, outcome, formData)` — no per-client configuration required.

The outcome handling was already correct and is **not** the cause: the v2 device submits an outcome CODE (`POSITIVE`) + a separate status field (`houseStatus: "Open"`), and `canonicalize.ts` recombines them into the v1 verbose label (`"Positive & Door Open"`) the templates branch on (ADR-0057). That shim is tested and works.

## Decision

Make `fieldReportService.render` resolve the template **most-specific → least-specific** (v1 parity):

1. an admin-authored `report_layouts` row for the `(client, product, verificationType)` — **overrides** (unchanged);
2. **else the built-in `FIELD_REPORT_DEFAULTS[verificationType]`** — the standard template + column catalog for that field type, rendered through the SAME `canonicalize → renderNarrative` path;
3. else `narrative: null` (a non-field / KYC verification type that has no standard default) — unchanged, a normal 200.

The 9 FIELD_AGENT verification-unit codes on prod (`RESIDENCE, OFFICE, BUSINESS, RESIDENCE_CUM_OFFICE, PROPERTY_INDIVIDUAL, PROPERTY_APF, BUILDER, DSA_CONNECTOR, NOC`) equal the 9 `FIELD_REPORT_DEFAULTS` keys **1:1**, so every field type now produces its report with zero configuration; admins can still author a layout to override per client/product.

`renderNarrative` is relaxed to a minimal `RenderColumn` shape (`columnKey` + `sourceType` + `sourceRef`) so the stored `ReportLayoutColumn[]` and the default `ReportLayoutColumnInput[]` both render through one contract — no read-model-only fields fabricated.

## Consequences

- **A field verification produces its report out of the box** — matching v1, with no admin step. A `Standard <TYPE>` default reports `layoutId: null`; an admin layout reports its real id/name.
- **No new attack surface.** The default templates are static and code-owned (no user input in the body); the render path keeps the existing prototype-pollution guards and plain-text output (consumer output-encodes). The route stays `case.view`-gated + scope-guarded; the form data rendered is the same data already exposed via the R1 `sections`.
- **No schema / route / OpenAPI change; no migration.** `FieldReportView.layoutId` was already nullable, so the FE handles `narrative != null && layoutId == null`.
- **Coverage:** the per-type render tests (`defaults.*.render.test.ts`), the canonicalization tests (`canonicalize.render.test.ts`), and the SDK validity/drift guard (`fieldReportDefaults.test.ts`) already prove every type × outcome renders; a new API test asserts the end-to-end fallback for a no-layout RESIDENCE task (the CASE-000018 shape) — previously `null`, now the positive-door-open narrative.
- The CASE_REPORT (aggregate client PDF/Word, ADR-0041) is a separate engine and is out of scope here.
