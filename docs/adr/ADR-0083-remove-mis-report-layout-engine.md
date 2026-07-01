# ADR-0083 — Remove the MIS / Report-Layout / office data-entry engine (clean slate)

**Status:** Accepted · **Owner-confirmed** (2026-07-01) · **Supersedes:** ADR-0037 (MIS Layout Engine),
ADR-0049 (MIS generation & export engine), and the `report_layouts`-backed *authoring* half of ADR-0039
(FIELD_REPORT) / ADR-0041 (CASE_REPORT). **Migration:** `0108` (drops `report_layouts`,
`report_layout_columns`, `case_data_entries`, `case_pickups`; deletes the `page.mis`,
`data_entry.manage`, `report_template.manage` permissions).

## Context

The "MIS Layout" system had grown into one shared `report_layouts` table keyed by
`kind ∈ {DATA_ENTRY, MIS, BILLING_MIS, FIELD_REPORT, CASE_REPORT}`, fronted by a single admin page
titled **"MIS Layouts"** plus a separate **`/mis`** generation page. In practice this conflated five
unrelated concerns behind one confusing "MIS" surface (owner: "MIS Billing / MIS Data Entry … all those
things are making things complicated"). The owner decided to **remove the whole thing** and rebuild MIS
later with a proper, purpose-built design — this ADR is the teardown, not a redesign.

What existed at HEAD:

- **MIS generation (ADR-0049):** `apps/api/src/modules/mis/`, `/api/v2/mis`, `apps/web/.../mis/MisPage.tsx`
  (`/mis`), `packages/sdk/src/mis.ts`, permission `page.mis` (mig 0082).
- **The layout store + designer (ADR-0037):** `report_layouts` + `report_layout_columns` (migs 0060/0064/0066),
  `apps/api/src/modules/reportLayouts/`, the unified `ReportLayoutsPage` / `ReportLayoutRecordPage`
  ("MIS Layouts" nav), `packages/sdk/src/reportLayouts.ts`, permission `report_template.manage`.
- **Office data-entry keying + pickup:** `apps/api/src/modules/caseDataEntries/`, `/api/v2/data-entry`,
  `case_data_entries` (migs 0061/0062) + `case_pickups` (mig 0063), permission `data_entry.manage`, and
  the `DataEntrySection` / `PickupSection` on `CaseDetailPage`. `case_data_entries.layout_id` FK-referenced
  `report_layouts` (the `DATA_ENTRY` layout *defined* the keying form — no code fallback).

Two report engines *read* `report_layouts` but already fall back to code defaults when no layout is
configured (which prod always was — **zero `report_layouts` rows ever existed on prod**, ADR-0079):

- **fieldReports (ADR-0039/0079/0080):** custom `FIELD_REPORT` layout → else `FIELD_REPORT_DEFAULTS`.
- **caseReports (ADR-0041):** custom `CASE_REPORT` layout body/geometry → else `DEFAULT_CASE_REPORT_TEMPLATE`
  + default page geometry.

## Decision

**Remove the entire MIS / report-layout / office data-entry engine**, keeping field-report and
case-report rendering alive on their built-in defaults.

Deleted:

- `mis` api module + `/mis` page + `packages/sdk/src/mis.ts` + `page.mis` permission.
- `reportLayouts` api module + both `/admin/report-layouts` pages + the "MIS Layouts" nav + the
  `report_template.manage` permission. (`packages/sdk/src/reportLayouts.ts` is **retained** — it also
  exports shared types still consumed by the surviving field/case report code: `FieldReportView`,
  `PageSize`/`PageOrientation`, `ReportLayoutColumn(Input)`, `SOURCE_CATALOG`, `CreateReportLayoutSchema`.
  The now-dead client methods and admin pages are gone; the leaf types stay as a shared contract.)
- `caseDataEntries` api module + `/api/v2/data-entry` + the `DataEntrySection`/`PickupSection` on
  `CaseDetailPage` + the `data_entry.manage` permission. Office data-entry keying **and pickup** are
  removed (owner-confirmed) — there was no code fallback once the `DATA_ENTRY` layout store is gone.
- Tables `report_layouts`, `report_layout_columns`, `case_data_entries`, `case_pickups` (mig `0108`).

Decoupled (kept working, defaults only):

- `fieldReports/service.ts` no longer reads `report_layouts`; `resolveNarrative` renders straight from
  `FIELD_REPORT_DEFAULTS` (null for a non-field / KYC type with no default). This is the exact path prod
  already used exclusively.
- `caseReports/service.ts` no longer reads `report_layouts`; `layout` is always `null`, so the renderer
  supplies `DEFAULT_CASE_REPORT_TEMPLATE` + default page geometry — again prod's existing path.

## Consequences

- **No visible feature loss for reports:** field/case report rendering is byte-identical to prod today
  (which had no custom layouts). The per-task field-report snapshot (ADR-0080) is unaffected — it stores a
  denormalized `layout_id`/`layout_name` (no FK) and continues to freeze the default-rendered narrative.
- **Office data-entry keying + pickup are removed**, not just disabled — owner-confirmed, to be rebuilt
  with the new MIS design. Existing `case_data_entries` / `case_pickups` data is dropped with the tables.
- **MIS is a clean slate.** No `/mis`, no "MIS Layouts", no report-layout endpoints, no MIS/data-entry
  permissions. A future MIS is a fresh, purpose-built ADR — not a fork of this engine.
- Migration `0108` is forward-only + idempotent (`DROP TABLE IF EXISTS … CASCADE`, `DELETE FROM
  role_permissions …`), re-run-safe under the every-deploy re-apply model (creating migs 0060–0082 all run
  before it). The roles-seed parity gate stays green: the deleted perms leave `ROLE_PERMISSIONS` and the
  live `role_permissions` in lock-step.

## Alternatives considered

- **Surgical (keep the table, drop only MIS/BILLING_MIS kinds + `/mis`).** Rejected by the owner in favour
  of a full teardown + fresh rebuild — the shared multi-kind designer was the source of the confusion.
- **Keep office data-entry, decouple only the layout lookup.** Rejected: the `DATA_ENTRY` layout *is* the
  form definition; with the store gone there is nothing to key against, so the owner removed the feature
  (incl. pickup) outright pending a redesign.
