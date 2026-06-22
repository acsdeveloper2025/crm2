# A7 — Ops/Money Export Field-Coverage + RBAC Audit (MIS · Billing · Commission · Field-Monitoring · Notifications)

**Scope:** READ-ONLY audit of XLSX/CSV export field coverage + RBAC for the money/operations reporting surfaces.
**Date:** 2026-06-22 · **Auditor agent:** A7 · **No source edited.**

Shared export engine: `apps/api/src/platform/export/format.ts` (`toCsv`/`toXlsx`/`escapeCsvCell`/`neutralizeFormula`),
`index.ts` (`writeExport`/`assertExportable`/`resolveExport`), `job.ts` (`exportOrEnqueue`/`registerExportBuilder`).

---

## 0 — Engine-level confirmations (apply to all five surfaces)

| Check | Result | Evidence |
|---|---|---|
| Formula-injection guard (CWE-1236) on **every** CSV cell | ✅ | `escapeCsvCell` (format.ts:55) guards-AND-quotes; `toCsv` (61-66) runs it over header + every body cell. |
| Formula-injection guard on **every** XLSX string cell | ✅ | `toXlsx` (69-93) wraps each string cell in `neutralizeFormula`; numbers/dates pass as native types (correct). |
| RFC-4180 quoting + CRLF | ✅ | format.ts:57, 65. |
| ADR-0058 (export emits stored values, not uppercased display) | ✅ | Export `value()` extractors read repo fields directly; uppercasing is a FE display-only concern. No `.toUpperCase()` in any export manifest. |
| ≥10k → background job (IMPORT_EXPORT_STANDARD §2) | ⚠️ PARTIAL | Only `locations` registers an async builder + uses `exportOrEnqueue` (`registerJobs.ts:33`). **Billing, MIS, Field-Monitoring use plain `writeExport`** → at ≥10k they `assertExportable` → **413 EXPORT_TOO_LARGE**, never enqueue. Documented "incremental rollout" (job.ts:101) but standard §2 not met. See P1-1. |

---

## 1 — MIS (`apps/api/src/modules/mis/*`)

Config-driven: columns = the active `report_layouts` columns for (clientId, productId, 'MIS'). The layout columns
ARE the visible columns (no DataGrid column toggle). Money columns dropped server-side for non-`billing.view`.

**Column resolution:** `resolver.ts` maps each `ReportLayoutColumn.sourceType` → a static SQL fragment (source_ref
NEVER interpolated for FIXED sources; FREE sources bound as params). Money-carrying source types: `RATE_AMOUNT`
(`rt.bill_amount`) and `COMMISSION_AMOUNT` (`COALESCE(ct.commission_amount, com.commission_amount)`).

| Column (sourceType) | money/PII? | source field | EXPORT | RBAC-gated (billing.view drop)? | escaped? |
|---|---|---|---|---|---|
| TASK_FIELD (task_number, status, …, assignee_name, unit_name) | no | ct.*/au.name/vu.name | ✅ layout header | n/a | ✅ |
| CASE_FIELD (case_number, client_name, …) | no | cs.*/cl.name/p.name | ✅ | n/a | ✅ |
| APPLICANT_FIELD (name, **mobile**, pan, …) | **PII** | ap.mobile/ap.pan/ap.name | ✅ | ✗ not money-gated (admin-configured into layout) | ✅ |
| RATE_AMOUNT | **money** | rt.bill_amount | ✅ | ✅ dropped if !billing.view | ✅ |
| COMMISSION_AMOUNT | **money** | ct.commission_amount / com | ✅ | ✅ dropped if !billing.view | ✅ |
| TAT | no | COMPLETED_BAND | ✅ | n/a | ✅ |
| DATA_ENTRY_FIELD / FORM_DATA_PATH | maybe | de.data / form_data | ✅ | ✗ | ✅ |
| DOC_TYPE_COUNT / COMPUTED | no | NULL (v1) | ✅ (empty) | n/a | ✅ |

**G-4 money-drop — applied on BOTH paths ✅:** `filterColumns()` (service.ts:52) strips `RATE_AMOUNT`+`COMMISSION_AMOUNT`
for `!canViewBilling`. Called in `rows()` (service.ts:70) AND `exportRows()` (service.ts:122). `canViewBilling` honors
`grantsAll` (SUPER_ADMIN) and `billing.view`. **Reference pattern is correct and complete.**

**Filters respected on export ✅:** clientId, productId, completedFrom/To, search all forwarded (service.ts:124-136).
MIS export is `mode:'all'` only (MisPage.tsx:71) — no current/selected, no `cols` subsetting (acceptable for a report;
see P2-1). ≥10k → 413 (no async builder).

---

## 2 — Billing & Commission read-model (`apps/api/src/modules/billing/*`)

Whole surface gated `billing.view` at the route (`routes.ts:16-20`) — list, export, breakdown, per-case lines.
No money-drop logic needed: non-billing callers cannot reach it at all (403). Route comment (routes.ts:13-15) explicitly
chose `billing.view` over `data.export` to stop a `data.export`-only role (TEAM_LEADER) exfiltrating amounts.

| Column | money/PII? | source | EXPORT (header) | RBAC | escaped? |
|---|---|---|---|---|---|
| caseNumber | no | cs.case_number | ✅ Case | route billing.view | ✅ |
| client | no | cl.name | ✅ Client | " | ✅ |
| product | no | p.name | ✅ Product | " | ✅ |
| status | no | cs.status | ✅ Status | " | ✅ |
| completedTaskCount | no | count COMPLETED | ✅ Completed Tasks | " | ✅ |
| **billTotal** | **money** | SUM(rt.bill_amount*bill_count) | ✅ Bill Total | route-gated | ✅ |
| **commissionTotal** | **money** | SUM(commission_amount*bill_count) | ✅ Commission Total | route-gated | ✅ |
| lastCompletedAt | no | max(completed_at) | ✅ Last Completed | " | ✅ |

`BILLING_EXPORT_COLUMNS` (service.ts:41-50). Export respects filters/sort/search and `mode:'selected'` ids
(service.ts:92-107, scope-safe — ids applied on top of scoped query). `mode:'all'` → `assertExportable` (413 ≥10k).

**Per-case accordion lines** (`caseTasks`, repository.ts:146) carry `bill_amount`+`commission_amount` per task —
JSON only (no separate export endpoint), gated `billing.view`. Not an export-coverage gap.

**Commission HISTORY import:** ABSENT ✅ (forbidden-import surface satisfied). The only commission-related import is the
**rate-config** master data (`commissionRates`, §4 below), which is a different surface (rules, not history).

---

## 3 — Commission Rates master-data (`apps/api/src/modules/commissionRates/*`) — context only

NOT in the forbidden-import set: this is the **rate RULES config** (importable per standard §4 "Rates"), not Commission
History. Every route — list/export/import-template/import/create/revise — gated **`masterdata.manage`** (SA-effective),
**NOT `data.export`** (routes.ts:10-11 comment cites the 5b billing lesson). Import gated like create. ✅ Correct.

---

## 4 — Field Monitoring (`apps/api/src/modules/field-monitoring/*`)

USER-grain roster (one row per FIELD agent in the actor's hierarchy scope). No money columns. Carries **PII**.

| Column | money/PII? | source | EXPORT (header) | RBAC | escaped? |
|---|---|---|---|---|---|
| name | PII | u.name | ✅ Agent | export=`data.export` | ✅ |
| username | PII-ish | u.username | ✅ Username | " | ✅ |
| **employeeId** | PII | u.employee_id | ✅ Employee ID | " | ✅ |
| **phone** | **PII** | u.phone | ✅ Contact | " | ✅ |
| openTasks/inProgress/completedToday/overdue | no | aggregates | ✅ | " | ✅ (numeric) |
| territoryPincodes/territoryAreas | ops | counts | ✅ Pincodes/Areas | " | ✅ |
| lastActivityAt/lastLocationAt/createdAt/updatedAt | no | timestamps | ✅ | " | ✅ |

`FM_EXPORT_COLUMNS` (service.ts:26-41). Respects scope (`getScopedUserIds`), search, sort, `mode:'selected'`
(UUID-validated ids, service.ts:100), `mode:'all'`→413 ≥10k.

**RBAC ASYMMETRY (P0-1):** list/stats gated `page.field_monitoring` (SA/MGR/TL); **export gated only `data.export`**
(routes.ts:13), which **BACKEND_USER holds but `page.field_monitoring` it does NOT** (permissions.ts:127-140). So a
BACKEND_USER can export the entire FIELD-agent roster incl. `phone`/`employeeId`/territory **without being permitted to
view that console.** This is exactly the exfil pattern the billing route guarded against (billing/routes.ts:13-15).

---

## 5 — Notifications (`apps/api/src/modules/notifications/*`)

Per-user in-app feed, own-user scoped (identity, not a permission — routes.ts:5-8). **No export endpoint. No import
endpoint.** Forbidden-import (Notification History) rule satisfied ✅. Nothing to field-matrix for export coverage.

---

## RANKED GAP LIST

| ID | Pri | Surface | Issue | File:line | Fix sketch |
|---|---|---|---|---|---|
| **P0-1** | **P0** | Field-Monitoring | Export gated `data.export` only; BACKEND_USER (has data.export, lacks page.field_monitoring) can export the full agent roster incl. phone/employeeId PII without view access. | `field-monitoring/routes.ts:13` | Change export gate to `authorize(PERMISSIONS.FIELD_MONITORING_VIEW)` (mirror billing/routes.ts:16) so export shares the list's audience. All FM viewers also hold data.export, so no legit access lost. |
| **P1-1** | **P1** | MIS, Billing, Field-Monitoring | ≥10k `mode:'all'` export returns 413 instead of enqueuing a background job (no async builder registered) — standard §2 unmet. | `mis/service.ts:141`, `billing/service.ts:108`, `field-monitoring/service.ts:116` | Register an `ExportBuild` per resource (`registerJobs.ts` pattern, like `locations`) and route the controller through `exportOrEnqueue`. Currently intentional/deferred. |
| **P1-2** | **P1** | MIS | Export money-drop for a non-`billing.view` actor is NOT covered by a test — only `/rows` drop (test 2) and a billing.view export (test 6) are tested. Code is correct (service.ts:122) but a regression would be silent. | `mis/__tests__/mis.api.test.ts:369` | Add a test: TEAM_LEADER `/mis/export` CSV must NOT contain the RATE_AMOUNT/COMMISSION_AMOUNT headers/values. |
| **P2-1** | **P2** | MIS | Export supports only `mode:'all'`; no `current`/`selected`/visible-`cols` subset (standard §1 three modes). Acceptable for a config-report but diverges from the universal contract. | `mis/MisPage.tsx:71`, `mis/service.ts:93` | Optional: thread mode/cols/ids through if MIS gains a DataGrid; low value while MIS is an rtable report. |
| **P2-2** | **P2** | MIS | APPLICANT_FIELD `mobile`/`pan` (PII) and DATA_ENTRY/FORM_DATA columns are exported with no PII gate — they ride on whoever the admin puts in the layout + `page.mis`. No leak vs the on-screen view (same columns shown), but worth a note: MIS PII exposure = layout-author's responsibility, not enforced. | `mis/resolver.ts:49-55` | Document/accept; or add a PII-source permission gate if PII-in-MIS becomes a concern. (Not a regression.) |

**No P0 found for:** formula-injection (all paths guarded), forbidden-import exposure (none of MIS/Billing/Commission-History/
Notifications/Field-Monitoring exposes an import), or MIS G-4 money-drop (correct on both paths).

---

## EXPLICIT CONFIRMATIONS (per task)

1. **MIS G-4 money-drop applied on BOTH `/rows` AND `/export`:** ✅ CONFIRMED. `filterColumns()` called in `rows()`
   (service.ts:70) and `exportRows()` (service.ts:122); honors `grantsAll` + `billing.view`.
2. **No forbidden-import surface exposes an import:** ✅ CONFIRMED. Billing History, Commission History (read-models in
   billing/mis), and Notification History have NO import endpoint. The only commission import is `commissionRates`
   rate-config (standard §4 importable; gated `masterdata.manage`, not `data.export`).
3. **Formula-injection neutralized on every export path:** ✅ (escapeCsvCell + neutralizeFormula in the shared engine all
   five surfaces route through).
4. **One real RBAC defect (P0-1):** Field-Monitoring export under-gated (`data.export`, should be `page.field_monitoring`).
