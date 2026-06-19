# MIS page — design spec (pure MIS, config-driven, commission-gated)

- **Date:** 2026-06-19 · **Status:** Ready to build
- **ADR:** ADR-0049 (mis-generation-engine). **Audit:** `docs/engineering/MIS_CROSS_AUDIT_2026-06-19.md`.
- **Scope lock:** pure MIS — case-task rows with all configured details **+ commission rate**, exportable. No billing/invoice/GST. `/billing` page kept; MIS is additive.

## 1. User-facing behaviour
A new **MIS** page (`/mis`, nav `page.mis`): pick **client → product** (cascading; product disabled until client) → optional **completed-date range** + **search** → **Generate**. The table columns come from the **active `MIS` layout** for that (client, product) — the columns an admin configured in the existing *MIS Layouts* designer. **Export** (XLSX / CSV) produces the same columns as a report. If no MIS layout is configured for the CPV → an empty-state ("No MIS layout configured for this client + product — configure one in MIS Layouts"). Commission/rate columns render **only** for `billing.view` holders.

## 2. Read-model (API) — `apps/api/src/modules/mis/`
A new module mirroring `billing` (controller/service/repository/routes + `__tests__`), mounted `/api/v2/mis` in `app.ts`.

### 2.1 Source resolver — `apps/api/src/modules/mis/resolver.ts`
A pure function `resolveColumn(col: ReportLayoutColumn, params: unknown[]) → { sql: string; alias: string }`. **The alias is code-generated** (`c0,c1,…` by index — never the raw `column_key`). `sql` per `source_type` (the SELECT vocabulary is code-owned — ADR-0049 R1/R2):

| source_type | mapping | safety |
|---|---|---|
| `TASK_FIELD` | static `Record<key, sqlFragment>` over the 16 catalog keys → `ct.*` / `au.name` (assignee) / `vu.name` (unit). **Authoritative column names: copy from `billing/repository.ts:144-161` (caseTasks) + `tasks` read-model — do NOT invent.** | key lookup; unknown → `NULL` |
| `CASE_FIELD` | static map over the 8 keys → `cs.*` / `cl.name` / `p.name`. Verify exact case columns (`backend_contact_number`, outcome, result_remark) against the `cases` schema + `cases/repository.ts`. | key lookup; unknown → `NULL` |
| `APPLICANT_FIELD` | static map over name/mobile/pan/applicant_type/calling_code → the applicant join (find the applicant/person table the case links; reuse the `cases` read-model's applicant join). | key lookup; unknown → `NULL` |
| `RATE_AMOUNT` | `rt.bill_amount` (RATE_LATERAL) | refless; **money** (gated, §2.3) |
| `COMMISSION_AMOUNT` | `COALESCE(ct.commission_amount, com.commission_amount)` (COMMISSION_LATERAL) | refless; **money** (gated) |
| `TAT` | `COMPLETED_BAND` (reuse the constant from `billing/repository.ts:45-52`) | refless |
| `DATA_ENTRY_FIELD` | `de.data ->> $n` where `$n` binds `source_ref` (LEFT JOIN the active DATA_ENTRY entry for the case — `case_data_entries`, case-grain mig 0062) | **bound param** |
| `FORM_DATA_PATH` | resolve in JS post-query via `walkPath(row.form_data, ref)` (mirror `fieldReports/render.ts:14-23`) — keep `ct.form_data` as a hidden select; OR `ct.form_data #>> $n::text[]` with the split, validated path bound | **bound / JS walk** |
| `DOC_TYPE_COUNT` | **v1: `NULL`** (no documents/doc-type table confirmed in v2 schema; deferred). Future: bind a correlated count with `= $n` + ref shape-validate. | deferred |
| `COMPUTED` | `NULL` (v1 — no expression compilation, ADR-0049 R1) | inert |

### 2.2 Repository — `repository.ts`
`misRows(opts)` builds, mirroring `billing.listCases` exactly:
- **FROM** = `case_tasks ct JOIN cases cs JOIN clients cl JOIN products p JOIN verification_units vu LEFT JOIN users au ON au.id = ct.assigned_to` + applicant join + (DATA_ENTRY_FIELD present → `LEFT JOIN case_data_entries de ON de.case_id = cs.id`) + (**any money column survived gating** → `RATE_LATERAL` + `COMMISSION_LATERAL`, else omit both).
- **SELECT** = the resolved `sql AS alias` list (money columns already dropped by the service when `!canViewBilling`).
- **WHERE** = reuse the billing filter shape: `ct.status = 'COMPLETED'` + `cs.client_id = $` + `cs.product_id = $` + `ct.completed_at >= / <= $` + `search` ILIKE + **the scope predicate** (reuse `billing`'s `caseScopePredicate`, or the task-grain `taskScopePredicate` from `platform/scope` — pick the one the pipeline/tasks read-model uses; verify in the plan).
- **ORDER BY** `ct.completed_at DESC, ct.id DESC` · `LIMIT/OFFSET` (paginated, like billing).
- Returns `{ rows: Array<Record<alias, unknown>>, totalCount }`.

### 2.3 Service — `service.ts` (gating + scope)
- `canViewBilling = req.auth.grantsAll === true || (req.auth.permissions ?? []).includes(PERMISSIONS.BILLING_VIEW)` (mirror `tasks/controller.ts:14-19`).
- Resolve the active layout: `reportLayoutRepository.findActiveByConfig(clientId, productId, 'MIS')`. `null` → `{ columns: [], rows: [], totalCount: 0 }` (empty-state, **not** an error).
- **Drop money columns when `!canViewBilling`**: filter out `source_type ∈ {RATE_AMOUNT, COMMISSION_AMOUNT}` from the layout columns **before** resolving SQL and building the row shape (ADR-0049 R3, closes G-4).
- `resolveScope(actor)` → pass to the repository (ADR-0049 R4). `toPosInt` the client/product params.
- Returns `{ columns: MisColumn[]; rows; totalCount }` where `MisColumn = { key: alias, header: header_label, dataType }` — the FE renders straight from this (server-authoritative column set).

### 2.4 Routes — `routes.ts`
```
GET /api/v2/mis/rows     authorize(page.mis)   → { columns, rows, totalCount }   (paginated; clientId, productId required)
GET /api/v2/mis/export   authorize(page.mis)   → XLSX|CSV via platform/export     (same filter; money dropped if !billing.view)
```
Export shares the rows audience (`page.mis`) with money dropped per-actor — mirrors `billing/routes.ts` "export shares the list's audience" but per-column, not blanket-403. `assertExportable` row cap + `writeExport` audit line `resource:'mis'` + actorId (ADR-0049 R5). Hidden helper columns (form_data) never reach output.

## 3. Platform — XLSX formula-escape (G-9, ADR-0049 R5)
Harden `apps/api/src/platform/export/format.ts` so `toXlsx` neutralizes formula-leading cells (apply the existing `escapeCsvCell` leading-char guard, or write string cells as text). Add a `platform/export` unit test covering a `=cmd` / `+1` / `-1` / `@x` cell in both CSV and XLSX. Platform-wide fix.

## 4. RBAC — `packages/access/src/permissions.ts` + mig 0081
- Add `MIS_VIEW: 'page.mis'` + `PERMISSION_META['page.mis'] = { label: 'MIS — View', group: 'Operations' }`.
- Add `PERMISSIONS.MIS_VIEW` to `ROLE_PERMISSIONS` for **MANAGER, TEAM_LEADER, BACKEND_USER** (SUPER_ADMIN via `Object.values`). (Updates the day-0 parity reference + its seed parity test.)
- **Migration `0081`** seeds `page.mis` into `role_permissions` for those roles (triple-write per `feedback_sql_live_db_apply`: the live runtime source is the table — ADR-0022). Idempotent insert (`ON CONFLICT DO NOTHING`).

## 5. SDK — `packages/sdk/src/mis.ts` + `client.ts`
- Types: `MisColumn`, `MisRowsResponse { columns: MisColumn[]; rows: Record<string, unknown>[]; totalCount: number }`, `MisQuery { clientId; productId; completedFrom?; completedTo?; search?; page?; pageSize? }`.
- Client methods: `mis.rows(query)` , `mis.exportUrl(query, format)` (or `mis.export` returning a blob, mirroring the billing export client). **Cover both in `packages/sdk/src/client.test.ts`** (coverage gate). Regenerate `openapi.json` (`pnpm openapi`).

## 6. Web — `apps/web/src/features/mis/MisPage.tsx` + route + nav
- Route `/mis` in `App.tsx` (gated `page.mis`), lazy like the others.
- Nav: `Layout.tsx:40` `{ label: 'MIS & Billing' }` → `{ label: 'MIS', to: '/mis', perm: 'page.mis' }` (rename to **MIS** — "pure MIS"; the separate `Billing & Commission` item stays).
- Page: cascading **client → product** picker (reuse the same picker the BillingPage / ReportLayouts designer uses), **completed-date range** + **search**, **Generate** → `mis.rows`. Render a **DataGrid** whose columns are `response.columns` (server-authoritative; money columns simply absent for non-billing.view) and rows keyed by `col.key`. **Export** button → `mis.export` (XLSX default; CSV option). Empty-state when `columns.length === 0`. Mirror `BillingPage.tsx` structure (DataGrid + toolbar) — do not duplicate its billing read-model.

## 7. Acceptance — the "done" worked example
Configure (MIS Layouts designer) an active `MIS` layout for a real (client, product) with columns: `case_number` (CASE_FIELD), applicant `name` (APPLICANT_FIELD), `product_name`, `task_number` (TASK_FIELD), `unit_name`, `visit_type`, `completed_at`, `TAT`, `verification_outcome`, `RATE_AMOUNT`, `COMMISSION_AMOUNT`. Run a completed case, then:
1. **billing.view user (MANAGER/SA):** MIS shows all 11 columns; `RATE_AMOUNT`/`COMMISSION_AMOUNT` equal the per-task amounts from the `/billing` read-model (same laterals). Export XLSX → identical columns.
2. **non-billing.view user (TEAM_LEADER):** same MIS **without** the two money columns (server-dropped, not FE-hidden); export likewise has no money columns. **(G-4 closed.)**
3. **Scope:** a user not in scope of the client → 0 rows (not a 403 on the page).
4. **Export safety:** a task whose `remark` is `=HYPERLINK("http://x")` exports as inert text in both XLSX + CSV. **(G-9 closed.)**
5. Mobile `/api/v2` unaffected (additive module; no shared route touched).

## 8. Build order (slices → the plan)
1. Platform XLSX escape (G-9) + test — isolated, unblocks safe export.
2. `page.mis` perm + mig 0081 + parity test.
3. Resolver + repository + service (TDD: resolver unit tests for each source_type incl. injection/binding; api tests for gating + scope + empty-state).
4. Routes + SDK + OpenAPI + client.test.
5. Web page + nav + route.
6. Verify: `pnpm verify` + CI (e2e/a11y) + live browser-verify the acceptance example.

## Out of scope (v1)
`COMPUTED` columns (resolve to NULL); the office data-entry write screen (already shipped, mig 0062); `BILLING_MIS` kind as a separate page; heavy aggregate MIS (`mv_` — future, per ADR-0010); the layout designer's drag-reorder / Excel-import / clone (ADR-0037 slice-2 net-new items, not part of generation).
