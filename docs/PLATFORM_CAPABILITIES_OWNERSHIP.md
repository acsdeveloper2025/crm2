# Mandatory Platform Capabilities — Location & Ownership (CRM2)

> **The mandatory capabilities are frozen and must exist; the only open question was *where* they
> live. This document answers it permanently.** All capabilities are **app-internal** and consume the
> existing 6 packages — **package extraction remains DEFERRED** (no new package without an ADR;
> `docs/ARCHITECTURE_GOVERNANCE.md`, `FROZEN_DECISIONS_REGISTRY.md` #24/#26). Build is DEFERRED
> (`docs/COMPLIANCE_GAPS_REGISTRY.md` B-1…B-14); this fixes the **location, ownership, and package
> dependencies** so the first build lands in the right place. SoT companions:
> `docs/DATAGRID_STANDARD.md`, `docs/IMPORT_EXPORT_STANDARD.md`,
> `docs/PAGINATION_AND_LOADING_STANDARDS.md`, `ALLOWED_DEPENDENCIES.md`.

---

## Part 1 — DataGrid (incl. search · filters · pagination · saved views · column visibility · export · loading/skeleton)

- **Location:** `apps/web/src/components/ui/data-grid/` (app-internal; conceptual `@crm2/ui/DataGrid`).
  Suggested internal layout: `DataGrid.tsx` · `useDataGridState.ts` (URL state: search/filters/sort/
  page/pageSize/columns/view) · `toolbar/` (global search, column-visibility, saved-views, export menu) ·
  `filters/` (column search + Excel-style header filters + multi-column) · `export/` (export dialog) ·
  `skeleton.tsx` · `states.tsx` (empty/error/permission).
- **Ownership:** `@crm2/web` (platform-UI). It is the **only** data table — no alternative grid.
- **Dependencies:** **TanStack Table** (headless) + **TanStack Query** (data) + **`@crm2/sdk`**
  (the `ListQuery` params + `Paginated<T>` envelope + filter/sort/saved-view DTOs; the only data path) +
  **`@crm2/ui-theme`** (token classes for grid/filter/skeleton/export-dialog styling) + **`@crm2/access`**
  (permission state). No new package.

## Part 2 — Import Engine (template · validation · preview · error report · audit · background processing)

- **Location (engine, backend):** `apps/api/src/platform/import/` (template registry, parser,
  validation/preview pass, processor that writes via the **domain repository**, import-audit writer).
  **Background processing:** `apps/worker/` (BullMQ job consumes large imports). **UI flow (web):**
  `apps/web/src/components/import/` (download template → upload → preview errors → confirm →
  result summary). **Contracts:** `@crm2/sdk` (import request / validation-report / import-audit DTOs;
  per-domain Validator reuses the domain's zod contract).
- **Ownership:** `@crm2/api` platform (the engine) + `@crm2/web` (the flow UI). Conceptual
  `@crm2/import-engine`; app-internal until a 2nd app needs it (then ADR).
- **Dependencies:** `@crm2/sdk` (contracts + reuse domain validators) · `@crm2/logger` (**import audit
  logs** + job logs) · `@crm2/config` (limits + `STORAGE_BACKEND` for the uploaded file + `REDIS_QUEUE_URL`
  for jobs) · `@crm2/access` (an `data.import` permission — added when built) · domain repositories
  (processor writes) · `@crm2/ui-theme` (import-dialog styling). Audit also persists a DB record
  (User/Date/File/Total/Success/Failed/Duration).

## Part 3 — Export Engine (CSV · XLSX · current view · selected rows · all matching · large jobs)

- **Location (engine, backend):** `apps/api/src/platform/export/` (XLSX/CSV/PDF builders;
  re-runs the DataGrid's server query **without the page `LIMIT`** for "all matching"). **Large exports
  (≥10k):** `apps/report-worker/` (background job → stores the file in the object store → notifies).
  **Entry point (web):** the DataGrid `export/` toolbar (current view · selected rows · all matching) —
  **the DataGrid is the only export surface; no module writes its own export**. **Contracts:** `@crm2/sdk`
  (export request DTO: format + the same ListQuery/selection).
- **Ownership:** `@crm2/api` platform (builders + job) + `@crm2/web` DataGrid (entry point) +
  `@crm2/report-worker` (large-export jobs).
- **Dependencies:** `@crm2/sdk` (export contracts) · `@crm2/logger` (**export audit / job logs**) ·
  `@crm2/config` (`EXPORT_JOB_THRESHOLD≈10000`, `STORAGE_BACKEND`, `REDIS_QUEUE_URL`) · `@crm2/access`
  (`data.export` permission — added when built) · `@crm2/ui-theme` (export-dialog styling) · object store
  (file storage + signed-URL download).

## Part 4 — Package integration per capability

| Capability | @crm2/sdk | @crm2/access | @crm2/config | @crm2/logger | @crm2/test-utils | @crm2/ui-theme |
|---|---|---|---|---|---|---|
| DataGrid (search/filters/pagination/saved-views/columns/loading) | ✅ query+envelope contracts | ✅ permission state | — | — (FE) | ✅ grid tests | ✅ styling tokens |
| Export engine | ✅ export contracts | ✅ `data.export` | ✅ threshold/storage/queue | ✅ audit+job logs | ✅ | ✅ dialog styling |
| Import engine | ✅ import contracts + domain validators | ✅ `data.import` | ✅ storage/queue/limits | ✅ import audit logs | ✅ | ✅ dialog styling |

**No package responsibility needs to *expand its boundaries* (each stays what it is); the capabilities
*consume* the packages.** The scope clarifications below are responsibility statements, not new powers.

## Part 5 — Package scope (responsibilities clarified — frozen)

- **`@crm2/ui-theme`** — provides the **token classes** the in-app DataGrid/filters/skeletons/export &
  import dialogs use (grid/filter/loading/skeleton/dialog styling). *Still tokens-only — it does NOT
  house the components* (frozen: components owned in-app).
- **`@crm2/logger`** — is the logger for **import audit logs, export audit logs, and background-job
  logs** (in addition to request/app logs). Audit *records* also persist to DB; logger emits the
  structured log lines.
- **`@crm2/sdk`** — carries **import contracts, export contracts, saved-view contracts, and the DataGrid
  query contracts** (`ListQuery` params + `Paginated<T>` envelope + filter/sort DTOs) — the single
  contract layer for web + mobile.
- **`@crm2/access`** — gains `data.import` / `data.export` permission codes (added when the engines are
  built; default-deny).
- **`@crm2/config`** — owns the export/import limits + `STORAGE_BACKEND` + `REDIS_QUEUE_URL` already in
  its env schema; adds `EXPORT_JOB_THRESHOLD` when the export engine lands.
- **`@crm2/test-utils`** — gains DataGrid/import/export test fixtures when those land.

---
*Location & ownership are frozen; package **extraction stays DEFERRED**. Change a location/ownership
decision only via a superseding ADR + CTO (`docs/ARCHITECTURE_GOVERNANCE.md`).*
