# Universal Import / Export Standard (CRM2)

> **Permanent platform-standardization freeze (2026-06-05).** Import/Export is a **first-class
> platform capability**, not a per-module feature — there must be **one** export path and **one**
> import engine, never 20 bespoke implementations. No redesign; governance + standardization only.
> SoT companions: `docs/DATAGRID_STANDARD.md` (export entry point), `docs/PAGINATION_AND_LOADING_STANDARDS.md`
> (background jobs), `docs/FROZEN_DECISIONS_REGISTRY.md`, `FREEZE_LOCK_REPORT.md`,
> `docs/COMPLIANCE_GAPS_REGISTRY.md` (status — DEFERRED until built).

---

## 1 — Export is owned by the DataGrid (single entry point)

Every operational DataGrid is the **only** export surface. No module writes its own export. Every
grid supports three export modes:
1. **Export Current View** — exactly what the user sees.
2. **Export Selected Rows** — the current row selection.
3. **Export All Matching Records** — everything matching the active search + filters (not just the page).

**Formats:** Primary **XLSX** · Secondary **CSV** · Optional **PDF**.

Export **must respect**: search · filters · sorting · visible columns · saved view. (Exporting
"all matching" re-runs the same server query without the page `LIMIT`, streamed into the job.)

## 2 — Export performance rules

| Size | Behaviour |
|---|---|
| **< 10,000 rows** | generate immediately (synchronous download). |
| **≥ 10,000 rows** | **background job required** — user keeps working; notification (bell/toast/in-app) when ready; download link. |

Consistent with `docs/PAGINATION_AND_LOADING_STANDARDS.md` §5/§10. No export ever blocks the UI or
returns an unbounded synchronous payload.

## 3 — Mandatory export pages

**Operations:** Pipeline · Cases · Tasks · MIS · Reports · Billing · Commission · Field Monitoring ·
Attendance Monitoring · Notifications · Audit Logs.
**Administration:** Clients · Products · Verification Units · CPV Mapping · Rate Management ·
Location Management · Users · Roles · Permissions.
Every one exports via the DataGrid (no bespoke export).

## 4 — Import support (where appropriate only)

**Mandatory import support:** Clients · Products · Verification Units · CPV Mapping · Rates ·
Country · State · City · Pincode · Users · Case Creation · Bulk Assignment.
**Optional:** Bank MIS Upload · Client Data Upload.
**Forbidden import (history/system surfaces):** Audit Logs · Billing History · Commission History ·
System Logs · Notification History. (These are append-only system records — never importable.)

## 5 — Standard import flow (no direct inserts, no silent imports)

```
Download Template → Fill Excel → Upload File → Validation → Preview Errors
→ Confirm Import → Background Processing → Result Summary
```

Every import follows this exact flow. Validation happens before any write; the user explicitly
**confirms** after previewing errors; processing runs as a background job; a result summary is shown.
No path inserts directly or imports silently.

## 6 — Import validation report

Every import returns: **Total Rows · Success Rows · Failed Rows · Duration** + a **downloadable
error file**. Error-file columns: **Row Number · Column Name · Error Message**. Failed rows never
block valid rows unless the import is declared atomic for that domain.

## 7 — Import audit log (traceability)

Every import writes a **permanent audit record**: User · Date · File Name · Total Rows · Successful
Rows · Failed Rows · Duration. Import operations must be fully traceable (ties into the platform
audit chain).

## 8 — Universal Import Engine (one framework)

There is **one** import framework — conceptually `@crm2/import-engine`. **No custom per-module import
implementations.** Each importable domain only provides four small pieces:
- **Template** — the downloadable Excel/CSV template (columns + sample).
- **Validator** — per-row + cross-row validation rules (reuses the domain's zod contract from `@crm2/sdk`).
- **Mapper** — file columns → domain fields.
- **Processor** — the idempotent batch writer (via the domain repository; background job for large files).

The engine owns: template download, upload parsing, the validation/preview pass, the confirm step,
background processing, the validation report, and the import audit record. Domains plug in; they do
not re-implement the flow.

**Package reconciliation (governance):** the frozen package set is 5 + `@crm2/logger`, with "no
`@crm2/ui`, components owned in-app" (`FROZEN_DECISIONS_REGISTRY.md` #24). Therefore the import
engine is **owned app-internal** — backend at `apps/api/src/platform/import/`, the import UI
flow at `apps/web/src/components/import/`, contracts in `@crm2/sdk` — exactly as `@crm2/ui/DataGrid`
is app-internal. `@crm2/import-engine` is the **conceptual** name. Promoting it to a real package
(e.g. if the worker/mobile need it directly) requires a **superseding ADR + CTO** per
`docs/ARCHITECTURE_GOVERNANCE.md`. Do **not** create a new package silently.

## 9 — Build status

The import/export engine is a **frozen standard, not yet built** (DEFERRED — `docs/COMPLIANCE_GAPS_REGISTRY.md`
B-13/B-14). It is built once (with the first operational export/import need) and reused everywhere;
no module ships a bespoke import or export. Exports depend on the DataGrid + paginated endpoints;
imports depend on the engine + background-job infra.

---
*Change this frozen standard only via a superseding ADR + CTO + domain-owner sign-off
(`LONG_TERM_PROTECTION.md`).*
