# Excel (.xlsx) + CSV Import/Export Coverage Audit & Fix — 2026-06-22

> Scope: audit + fix import/export **field coverage** across the platform, page by page, **admin /
> master-data first**, so every field used to ADD or EDIT a record is both importable and exportable
> with correct headers, validation, case handling (ADR-0058), escaping (CWE-1236 / G-9), RBAC, and a
> lossless round-trip. Built via the CRM2 multi-agent method (CTO + specialist subagents).
>
> SoT for the standard: [`docs/IMPORT_EXPORT_STANDARD.md`](../../IMPORT_EXPORT_STANDARD.md).
> Per-page field matrices: `A1`–`A7` in this folder. Dispositions: [`COMPLIANCE_GAPS_REGISTRY.md`](../../COMPLIANCE_GAPS_REGISTRY.md) §IE-2026-06-22.

## Shared infrastructure (reused, not reinvented)

| Layer | File | What it owns |
|---|---|---|
| Export engine | `apps/api/src/platform/export/format.ts` | `ExportColumn<T>` manifest · `toCsv`/`toXlsx` · `escapeCsvCell` + `neutralizeFormula` (CWE-1236) |
| Export streaming | `apps/api/src/platform/export/index.ts` · `job.ts` | re-runs the list query · `current`/`all`/`selected` · `cols` · ≥threshold background job |
| Import engine | `apps/api/src/platform/import/index.ts` | `ImportSpec{columns,schema(zod),uniqueKey,sample,resolve}` · preview/confirm · import_log · sync/background tiers |
| Import parsing | `apps/api/src/platform/import/{format,parsers}.ts` | `.xlsx` **and** `.csv` auto-detect (PK magic byte) · `parseIsoDate/Boolean/Integer/Number/CsvList` |
| Web UI | `apps/web/src/components/import/ImportModal.tsx` · DataGrid | Download Template → Upload → Preview → Confirm → result + error file |
| Case transform | `packages/sdk/src/text.ts` `toUpper` (ADR-0058) | display-text uppercased on EVERY write path incl. import (import reuses the SDK Create schema) |

**Key invariant confirmed across all importable entities:** every import `confirm` routes through the
domain's SDK `Create*Schema` (directly or via a `resolve` → `service.create`), so ADR-0058 `toUpper`,
UPPER_SNAKE-code, enum, email and cross-field invariants all run on import — **no path bypasses the
schema.** Both `.xlsx` and `.csv` are accepted everywhere (shared `parseImportFile`).

## Headline findings (deduped, ranked)

| # | Sev | Page / entity | Gap | Disposition |
|---|---|---|---|---|
| S-1 | **P0** | Users export | `GET /users/export` gated by bare `data.export` → MANAGER/TL/BACKEND_USER could export the full user list (name/phone/employeeId PII) without `page.users` (export wider than read) | **FIXED** → gate `USER_VIEW` |
| S-2 | **P0** | Field-Monitoring export | `GET /field-monitoring/export` bare `data.export` → BACKEND_USER could export the FIELD-agent roster (PII + territory) without `page.field_monitoring` | **FIXED** → gate `FIELD_MONITORING_VIEW` |
| S-3 | P1 | Roles export | `GET /roles/export` bare `data.export` → full RBAC topology disclosure to roles lacking `page.access` | **FIXED** → gate `ACCESS_VIEW` |
| S-4 | P1 | Report-Templates export | `GET /report-templates/export` bare `data.export` → exportable by roles that 403 on the template list (`page.templates`) | **FIXED** → gate `TEMPLATE_VIEW` |
| E-1 | **P0** | Commission Rates export | export DROPPED `location` (a REQUIRED key for LOCAL/OGL) + `product`/`verificationUnit`/`tatBand` → differently-dimensioned rows exported as identical/ambiguous, not round-trippable | **FIXED** → added all 4 dims + `currency` |
| E-2 | P1 | Rates export | `currency` (importable) + `effectiveTo` (history validity window) dropped from export | **FIXED** → both added |
| E-3 | P1 | Verification Units export | export emitted 9 of ~23 fields → lossy (export ⊉ import) | **FIXED** → export now mirrors the 19 import columns + audit cols (lossless round-trip) |
| E-4 | P1 | Users export | `email` (importable, PII) dropped from export → non-lossless round-trip | **FIXED** → `Email` column added |
| I-1 | P1 | Verification Units import | `requiredAttachments` not importable → **every KYC_DOCUMENT unit import failed** the ≥1-attachment invariant | **FIXED** → `Required Attachments` column (`TYPE[:MIN]` round-trip parser) |
| I-2 | P1 | Users import | `phone` (Create-form field) exportable but not importable | **FIXED** → `Phone` import column |
| R-1 | P1 | CPV Mapping (client_products) export | export emitted combined `"CODE — Name"` cells → not re-importable (import wants separate `Client Code`/`Product Code`) | **FIXED** → split code + name columns; round-trip test added |
| I-3 | P1 | Users import | `departmentId`/`designationId` (Create-form fields) not importable | **DEFERRED** (IE-DEFER-1) |
| I-4 | P1 | Designations import | export shows `Department` but import has no `departmentId` → re-import nulls it | **DEFERRED** (IE-DEFER-1) |
| C-1 | P0→P1 | CPV unit-enablement leg (`client_product_verification_units`) | the per-mapping unit-enablement leg has no import + no export | **DEFERRED** (IE-DEFER-2) — the primary "CPV Mapping" surface (client↔product) IS covered |
| O-1 | P0 | Case Creation bulk import | no bulk case import exists at all (import-mandatory §4) | **DEFERRED** (IE-DEFER-3) — needs its own ADR (ADR-0053 multi-applicant dedupe + ADR-0056 visit-type/location); cases module under parallel WIP |
| O-2 | P0/gov | Bulk Assignment file import | only an in-grid JSON action (`POST /tasks/bulk-assign`); no spreadsheet import | **DEFERRED** (IE-DEFER-3) |
| O-3 | P1 | Cases grid export · cases/tasks round-trip | Cases DataGrid has no `exportFn`; several case/task fields exported nowhere | **DEFERRED** (IE-DEFER-3) — cases/tasks under parallel WIP |
| O-4 | P1 | MIS / Billing / Field-Monitoring | `mode:all` ≥10k returns 413 instead of a background job (standard §2) | **DEFERRED** (IE-DEFER-4) — incremental rollout (only `locations` registers an async builder) |
| O-5 | P1 | Policies | admin DataGrid with no export (standard §1) | **DEFERRED** (IE-DEFER-5) |
| O-6 | P1 | Scope assignments | export ignores DataGrid filter/sort; emits labels not codes; no web UI surface | **DEFERRED** (IE-DEFER-6) |

WONTFIX (justified non-importable, content/system surfaces): Report Templates content blob, Report
Layouts designer artifact, Saved Views (per-user opaque state), System health, Reference lookups,
Policies content (versioned legal blob — bulk import unworkable + dangerous). Forbidden-import
history surfaces (Audit/Billing/Commission/Notification/System logs) correctly expose **no** import.

## What changed (before → after)

| Entity | Import before → after | Export before → after |
|---|---|---|
| Users | username, name, email, role, effectiveFrom → **+ phone** | …no Email → **+ Email**; gate `data.export` → **`page.users`** |
| Verification Units | 19 cols (no attachments) → **+ Required Attachments** (KYC unblocked) | 9 cols → **23 cols = all editable fields (import headers) + audit** (lossless) |
| Commission Rates | (unchanged — already full) | 8 cols → **+ product, unit, location, tatBand, currency** (no ambiguity; location never dropped) |
| Rates | (unchanged) | **+ currency, effectiveTo** |
| CPV Mapping | (unchanged) | combined `"CODE — Name"` → **separate Client/Product Code + Name** (round-trippable) |
| Roles | (no import — export-only, correct) | gate `data.export` → **`page.access`** |
| Report Templates | (no import — justified) | gate `data.export` → **`page.templates`** |
| Field Monitoring | (no import — roster read-model) | gate `data.export` → **`page.field_monitoring`** |

## Tests

Every fix is covered by an extended API integration test (gate assertion / new column header / value /
round-trip / KYC-invariant). Notably: a CPV **export→re-import preview** round-trip test (0 errors),
a VU KYC import + `TYPE:MIN` attachment round-trip, and the four export-gate 403s (a `data.export`-only
role is now denied each sensitive export). The pre-existing tests that *codified* the exfil
(`BACKEND_USER … can export (200)`) were flipped to assert 403.

## Verification
- `pnpm verify` (typecheck → lint → format → no-suppressions → boundaries → test → build): see session.
- API integration tests run against an ephemeral Postgres; CI `ci.yml` + Playwright e2e: see session.
- Browser-verify a representative import + export on 1–2 master-data pages: see session.
