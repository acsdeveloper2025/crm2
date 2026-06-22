# A5 — Import/Export Field-Coverage Audit: Reports + System + Reference

**Scope (this agent):** `reportLayouts`, `reportTemplates`, `saved-views`, `system`, `reference`.
**Date:** 2026-06-22 · **Mode:** READ-ONLY audit (no source edits).
**Engines:** export `apps/api/src/platform/export/format.ts` + `.../export/index.ts` · import `apps/api/src/platform/import/index.ts` + `.../import/format.ts`.
**Standard:** `docs/IMPORT_EXPORT_STANDARD.md` —
- §3 export-mandatory **Operations** list includes **"Reports"** (the MIS/Reports data surface — `mis` module, out of this agent's scope; it HAS an export manifest). report-templates/report-layouts/saved-views/reference are NOT named in §3.
- §4 import-mandatory list does NOT include any A5 entity. **System Logs are §4-forbidden import** (append-only system surface).

> **Headline:** only one A5 entity (`reportTemplates`) has any import/export at all — an **export-only** manifest that **drops the `content` handlebars/markdown blob** (justified: content is not a DataGrid column). No A5 entity is import-mandatory or export-mandatory, so there are **zero P0s**. The findings are P1 escaping-correctness on the blob-adjacent export, P2 round-trip/justification items, and several **justified non-importable / non-exportable** entities (saved-views = per-user opaque state; system = read-only diagnostics; reference = seeded lookup).

---

## Engine facts that decide every row below

- **CSV import IS supported.** `parseImportFile` (import/format.ts:159-161) auto-detects: `PK` magic bytes → XLSX (`parseImportXlsx`), else CSV (`parseImportCsv`). The doc-comment "XLSX only for now" (import/format.ts:6) is **stale** — the CSV path exists and is wired. So any new A5 import would get both formats free.
- **Import schema reuse is per-spec.** The engine validates each row with `spec.schema.safeParse` (import/index.ts:142). Whether SDK Create schema is reused depends entirely on what a module passes; **no A5 entity registers an ImportSpec**, so there is nothing to reuse/bypass today.
- **Export escaping is centralized and correct.** `escapeCsvCell` + `neutralizeFormula` (CWE-1236) run on every CSV cell (format.ts:62-63) and every XLSX string cell (format.ts:88). Any export added to an A5 entity inherits this.
- **`toUpper` (ADR-0058)** is applied in the SDK zod schemas to display-text (`name`, `headerLabel`, `section`) — **never** to codes/enums or to the content/template blobs (`content`, `templateBody`), which preserve case. Confirmed in `reportTemplates.ts` (content = `z.string().max(50000)`, no transform) and `reportLayouts.ts` (templateBody = trimmed, RAW-output-gated, no upper).

---

## ENTITY 1 — REPORT TEMPLATES (the only A5 entity with any import/export)

Add/edit fields from: FE form `apps/web/src/features/templates/TemplatesPage.tsx` `TemplateDialog` (L181-190: code, name, templateType, content, effectiveFrom) · SDK `packages/sdk/src/reportTemplates.ts` (`CreateReportTemplateSchema` L40 / `UpdateReportTemplateSchema` L49) · DB `apps/api/src/modules/reportTemplates/repository.ts` (`COLS` L11, INSERT L94).

Export manifest: `TEMPLATE_EXPORT_COLUMNS` — `reportTemplates/service.ts:53-61`. Route: `GET /report-templates/export` gated `DATA_EXPORT` (`routes.ts:13`). FE wires `exportFn` (`TemplatesPage.tsx:146`).
Import spec: **NONE.** No ImportSpec, no `registerImportRunner`, no `/import` route, no `importFn` on the FE DataGrid.

Metadata vs blob: `code`/`name`/`templateType`/`effectiveFrom`/`isActive` = metadata; **`content` = the handlebars/markdown blob.**

### Field matrix — Report Templates

| field | required? | DB column | SDK Create field | transform | IMPORT (✓/✗ + header) | EXPORT (✓/✗ + header) |
|---|---|---|---|---|---|---|
| code | yes | `code` | `code` | none (UPPER_SNAKE regex) | ✗ (no import) | ✓ "Code" |
| name | yes | `name` | `name` | **toUpper** | ✗ | ✓ "Name" |
| templateType | yes | `template_type` | `templateType` | enum/code | ✗ | ✓ "Type" |
| content | no (defaults `''`) | `content` | `content` | **blob** (no upper, ≤50 000) | ✗ | **✗ (deliberately not a column — see T-1/T-2)** |
| effectiveFrom | no | `effective_from` | `effectiveFrom` | isoDate | ✗ | ✓ "Effective From" |
| isActive / status | edit (activate) | `is_active` | — (activate route) | bool | ✗ | ✓ "Status" (Active/Inactive) |
| version | OCC token | `version` | — (sent on update) | none | ✗ | ✗ (correctly absent) |
| createdAt / updatedAt | system | `created_at`/`updated_at` | — | Date→ISO | ✗ | ✓ "Created"/"Updated" |
| createdBy / updatedBy | system | `created_by`/`updated_by` | — | none | ✗ | ✗ (absent — minor, P2) |

### Report Templates — verification checklist
- (i) export present where mandatory? **N/A** — "Reports" in §3 = the MIS/Reports data grid (mis module), NOT the template-authoring grid. Report-templates export is a (good) extra, not mandated.
- (ii) import exists? **No** — nothing to check for schema-reuse/CSV+XLSX. (Justification below.)
- (iii) export reflects stored values + escaping? **Yes for the 7 emitted columns** — re-runs the list query, cells go through `escapeCsvCell`/`neutralizeFormula`. `content` is NOT emitted, so the blob-escaping risk does not materialize **here** (it is the latent risk if `content` is ever added — see T-2).
- (iv) round-trip lossless for metadata? **No round-trip exists** (export-only, no import). Export alone is lossless for the 7 columns it carries.
- (v) blob import justification: **stays NON-importable (correct).** A template is authored handlebars/markdown with a security gate (RAW-output ban lives on layouts; templates cap at 50 000 chars). Bulk-importing executable template bodies from a spreadsheet is a stored-content injection vector and has no operational use case (templates are hand-authored, low-cardinality). **WONTFIX-justified.**

---

## ENTITY 2 — REPORT LAYOUTS (no import, no export)

Add/edit fields from: FE `apps/web/src/features/reportLayouts/ReportLayoutsPage.tsx` (`LayoutDialog`, designer form) · SDK `packages/sdk/src/reportLayouts.ts` (`CreateReportLayoutSchema` L296 / `UpdateReportLayoutSchema` L318 / `ReportLayoutColumnInputSchema` L188) · DB `repository.ts` (`HEADER_COLS` L34, `COLUMN_COLS` L37).

Import spec: **NONE.** Export manifest: **NONE.** Routes (`routes.ts`) = list/by-config/get/create/update/activate/deactivate only — no `/export`, no `/import`. FE DataGrid has **no `exportFn`** (`ReportLayoutsPage.tsx:799`).

Metadata vs blob: header `clientId`/`productId`/`kind`/`name`/`verificationType`/`pageSize`/`pageOrientation`/`isActive` = metadata; **`templateBody` = handlebars blob** (FIELD_REPORT/CASE_REPORT); **`columns[]` = a nested JSON child-table** (`report_layout_columns`, each with `options`/`validation` jsonb).

### Field matrix — Report Layouts (header + nested columns)

| field | required? | DB column | SDK Create field | transform | IMPORT | EXPORT |
|---|---|---|---|---|---|---|
| clientId | yes | `client_id` | `clientId` | fkId | ✗ | ✗ |
| productId | yes | `product_id` | `productId` | fkId | ✗ | ✗ |
| kind | yes | `kind` | `kind` | enum/code | ✗ | ✗ |
| name | yes | `name` | `name` | **toUpper** | ✗ | ✗ |
| verificationType | cond. (FIELD_REPORT) | `verification_type` | `verificationType` | none (code) | ✗ | ✗ |
| templateBody | cond. (FIELD/CASE_REPORT) | `template_body` | `templateBody` | **blob** (RAW-output gated, ≤20 000) | ✗ | ✗ |
| pageSize | cond. (CASE_REPORT) | `page_size` | `pageSize` | enum | ✗ | ✗ |
| pageOrientation | cond. (CASE_REPORT) | `page_orientation` | `pageOrientation` | enum | ✗ | ✗ |
| columns[].columnKey | yes (per col) | `column_key` | nested | none (lc regex) | ✗ | ✗ |
| columns[].headerLabel | yes | `header_label` | nested | **toUpper** | ✗ | ✗ |
| columns[].sourceType | yes | `source_type` | nested | enum/code | ✗ | ✗ |
| columns[].sourceRef | cond. | `source_ref` | nested | none (catalog-validated) | ✗ | ✗ |
| columns[].dataType | yes | `data_type` | nested | enum | ✗ | ✗ |
| columns[].displayOrder | no | `display_order` | nested | int | ✗ | ✗ |
| columns[].section | no | `section` | nested | **toUpper** | ✗ | ✗ |
| columns[].isRequired | no | `is_required` | nested | bool | ✗ | ✗ |
| columns[].options (jsonb) | no | `options` | nested | **JSON blob** | ✗ | ✗ |
| columns[].validation (jsonb) | no | `validation` | nested | **JSON blob** | ✗ | ✗ |
| isActive | edit (activate) | `is_active` | — | bool | ✗ | ✗ |
| version | OCC | `version` | — | none | ✗ | ✗ |

### Report Layouts — verification checklist
- (i) export present where mandatory? **N/A** — not in §3. (See L-1: arguably should export the header list for parity with every other admin DataGrid, but not mandated.)
- (ii) import exists? **No.**
- (v) import justification: **stays NON-importable (correct).** A layout is a nested designer artifact (header + ordered columns + per-column jsonb `options`/`validation` + a security-gated handlebars body). It does not flatten to a row-per-record spreadsheet, source bindings are validated against the code-owned `SOURCE_CATALOG`, and there is no bulk-authoring use case. **WONTFIX-justified.** A header-only export (L-1) is the only defensible enhancement.

---

## ENTITY 3 — SAVED VIEWS (no import, no export — justified)

Add/edit fields from: SDK `packages/sdk/src/savedViews.ts` (`CreateSavedViewSchema` L29 / `UpdateSavedViewSchema` L38 / `SetDefaultSavedViewSchema` L49) · DB `repository.ts` (`SELECT_COLS` L6). FE: created/managed inline from any DataGrid's view menu (no dedicated page, no toolbar export/import).

Import spec: **NONE.** Export manifest: **NONE.** Routes = list/create/set-default/update/delete; **own-user scoped, no permission gate** (identity-scoped like notifications/jobs).

| field | required? | DB column | SDK Create field | transform | IMPORT | EXPORT |
|---|---|---|---|---|---|---|
| resourceKey | yes | `resource_key` | `resourceKey` | none | ✗ | ✗ |
| name | yes | `name` | `name` | none (NOT upper — user label) | ✗ | ✗ |
| state (jsonb) | yes | `state` | `state` | **opaque JSON blob** (URL keys) | ✗ | ✗ |
| isDefault | no | `is_default` | `isDefault` | bool | ✗ | ✗ |
| id / createdAt / updatedAt | system | — | — | — | ✗ | ✗ |

### Saved Views — justification
**Stays NON-importable AND NON-exportable (correct).** A saved view is **per-user, own-scoped UI state** — an opaque `state` map of DataGrid URL keys (`q`/`sort`/`cols`/`f_*`), explicitly "opaque to the server" (savedViews.ts:13). It is not master data, not a report, has no cross-user meaning, and the DataGrid export/import surface is precisely what views *configure*. Bulk import/export is meaningless. **WONTFIX-justified — not in any §3/§4 list.**

---

## ENTITY 4 — SYSTEM (read-only health — import §4-forbidden, no export)

Fields from: SDK `packages/sdk/src/system.ts` (`SystemHealth`) · `system/repository.ts` (health query). **No add/edit form, no write contract** — a single `GET /system/health` gated `SYSTEM_VIEW` (SUPER_ADMIN).

| field | DB source | IMPORT | EXPORT |
|---|---|---|---|
| status / environment / serverTime | computed / `now()` | ✗ | ✗ |
| database{connected,latencyMs} | probe | ✗ | ✗ |
| push{configured,initialized,activeTokens} | FCM probe + `notification_tokens` count | ✗ | ✗ |
| counts{clients,products,…,locations} | `count(*)` per table | ✗ | ✗ |

### System — justification
**Import is §4-FORBIDDEN** ("System Logs … append-only system records — never importable") and there are **no writable fields** to import anyway. **Export is correctly absent** — health is a live ephemeral snapshot (latency, server time, live token count), not a DataGrid of records; exporting it has no traceable value and the page renders cards, not a grid. **WONTFIX-justified.**

---

## ENTITY 5 — REFERENCE (seeded mobile lookup — no import, no export)

Fields from: SDK `packages/sdk/src/reference.ts` (`VerificationTypeOutcome`, `RevokeReason`) · `reference/repository.ts`. **No write contract** — two read-only `GET` endpoints (`/verification-type-outcomes`, `/revoke-reasons`), authenticated, no permission gate (static catalog, mobile parity). Data is **seeded in migrations** (0069), wrapped in the v1 `{success,data}` envelope.

| field | DB source | IMPORT | EXPORT |
|---|---|---|---|
| verificationTypeOutcome{outcomeCode, displayLabel, sortOrder, isActive, …} | `verification_unit_outcomes` (seeded) | ✗ | ✗ |
| revokeReason{code, label, sortOrder, isActive} | `revoke_reasons` (seeded) | ✗ | ✗ |

### Reference — justification
**Stays NON-importable AND NON-exportable (correct).** These are **seeded lookup catalogs** with no admin CRUD surface at all (no create/update route, no FE management page). They change only via migration. Not in any §3/§4 list. **WONTFIX-justified.** (If an admin CRUD for these is ever built, master-data import/export parity should be revisited — tracked as R-1, P2.)

---

## RANKED GAP LIST

> Priority key — **P0**: a required add/edit field that import OR export drops on an entity where that mode is *mandatory*. **P1**: mandatory export entirely missing; optional field dropped; missing escaping on a blob cell; if import exists, missing CSV/XLSX or schema bypass. **P2**: polish / justified non-import-or-export.

**No P0 findings.** No A5 entity is import-mandatory or export-mandatory (the §3 "Reports" entry = the MIS module, out of scope and already exporting). Nothing required is silently dropped on a mandatory surface.

| id | pri | entity | field | mode | file:line | finding + fix sketch |
|---|---|---|---|---|---|---|
| **T-1** | **P1** | reportTemplates | `content` (blob) | export | `reportTemplates/service.ts:53-61` | The export manifest carries metadata only; the authored `content` body is dropped. Defensible as a DataGrid manifest (content isn't a grid column), but it means an "export" of templates is **not a backup** — the actual template source never leaves the system. **Fix (optional, owner call):** add a `{ id:'content', header:'Content', value:(t)=>t.content }` column **only behind an explicit opt-in column** (it is large + handlebars). If added, T-2 becomes mandatory. **Disposition recommendation: DEFER** (manifest is intentionally metadata-only). |
| **T-2** | **P1 (latent)** | reportTemplates | `content` (blob) | export | `export/format.ts:55-59,88` | **Escaping is already correct** for any blob cell — a `content` starting with `=`/`+`/`-`/`@` is `'`-prefixed (`neutralizeFormula`) and embedded commas/quotes/newlines are RFC-4180 quoted (`escapeCsvCell`) in BOTH CSV and XLSX. This is a **latent guarantee**, not a defect today (content isn't exported). Recorded so that **if T-1 ships, no new escaping work is needed** — the engine already handles formula-lead + comma/quote/newline blob cells. **Disposition: PASS (no action) / pair with T-1 if it ships.** |
| **L-1** | **P2** | reportLayouts | header list | export | `reportLayouts/ReportLayoutsPage.tsx:799`; `reportLayouts/service.ts` | Every other admin DataGrid (clients/products/users/templates…) exports; report-layouts is the lone admin grid with **no `exportFn`**. Not §3-mandated, but a consistency gap. **Fix:** add a header-only `ExportColumn<ReportLayoutView>[]` manifest (client/product/kind/name/columnCount/status/created/updated) + `GET /report-layouts/export` gated `DATA_EXPORT`/`TEMPLATE_MANAGE` + wire `exportFn`. Do NOT export `templateBody`/columns jsonb. **Disposition: DEFER** (parity nicety). |
| **TPL-3** | **P2** | reportTemplates | `createdBy`/`updatedBy` | export | `reportTemplates/service.ts:53-61` | Audit-actor columns present in `COLS` but not in the manifest, unlike some peer exports. Minor. **Fix:** add two `value` columns if actor traceability in the file is wanted. **Disposition: DEFER.** |
| **SV-1** | **P2** | saved-views | (whole entity) | both | `savedViews.ts:13`; `saved-views/routes.ts` | Justified non-import/export: per-user opaque UI state, own-scoped, not master data. **Disposition: WONTFIX (justified).** |
| **SYS-1** | **P2** | system | (whole entity) | import | `system/routes.ts:11`; STD §4 | Import is **§4-forbidden** (system surface) and there are no writable fields. Export also correctly absent (ephemeral health snapshot, card UI not a grid). **Disposition: WONTFIX (justified / forbidden).** |
| **R-1** | **P2** | reference | (whole entity) | both | `reference/routes.ts`; migration 0069 | Seeded lookup with no admin CRUD; changes only via migration. Not importable/exportable today and shouldn't be. **Fix only IF** an admin CRUD page is ever added → then add master-data import/export parity. **Disposition: WONTFIX-for-now (justified).** |
| **RL-1** | **P2** | reportLayouts | (whole entity) | import | `reportLayouts/routes.ts` | Justified non-importable: nested designer artifact (header + ordered columns + per-column jsonb + security-gated handlebars body), source bindings validated against code-owned `SOURCE_CATALOG`, no bulk-authoring use case. **Disposition: WONTFIX (justified).** |

---

## Cross-cutting notes

1. **The doc-comment "CSV import is a later follow-up" (import/format.ts:6) is STALE.** `parseImportCsv` exists and is wired via `parseImportFile` magic-byte detection (import/format.ts:159-161). Any A5 import added would support **both** XLSX and CSV with zero extra work. (Flag to A1–A4 agents too — none of them should report "CSV unsupported".)
2. **No A5 entity registers an ImportSpec**, so the ADR-0058 "does import reuse SDK Create schema or bypass it?" question is **N/A for all five** — there is no import path to bypass anything. (For contrast: when an A5 import is ever built, the engine's `spec.schema.safeParse` makes reuse of `CreateReportTemplateSchema`/`CreateReportLayoutSchema` trivial and correct — pass the SDK schema directly.)
3. **Blob-escaping safety is centralized and already correct** (T-2): `escapeCsvCell`/`neutralizeFormula` handle formula-lead + comma/quote/newline in both CSV and XLSX. No per-entity escaping work is ever needed for a blob cell; the only decision is *whether* to emit the blob at all.
4. **`toUpper` (ADR-0058) is correctly scoped** across A5: applied to display labels (`name`, `headerLabel`, `section`) and never to codes/enums or to `content`/`templateBody` blobs. An import would inherit this automatically by reusing the SDK Create schema.
