# MIS page — cross-audit synthesis (2026-06-19)

- **Date:** 2026-06-19
- **Method:** multi-agent specialist audit panel (V1 report auditor · v2 design/gap auditor · MIS-generation security auditor) → synthesized here. (The Zion *Billing-MIS* parity track was **dropped** — owner descoped billing; see Scope.)
- **Feeds:** ADR-0049 (mis-generation-engine) + `docs/specs/2026-06-19-mis-page-design.md` + the build plan.
- **Realizes:** ADR-0037 (mis-layout-engine, Accepted) **generation slice** + ADR-0015 (config-driven per-CPV reporting) MIS side. The config layer (layouts + columns + source catalog) already shipped; this is the missing **generation/export** half.

## Owner scope lock (2026-06-19)
> **PURE MIS.** One page that shows **case-task rows with ALL details + the commission rate**, exportable as a **report**. **No** billing subsystem, **no** invoices, **no** GST, **no** Billing-MIS-as-billing.

Three forks resolved by the owner (`AskUserQuestion`, 2026-06-19):
1. **Columns = config-driven** — per (client, product) via the already-shipped MIS Layouts designer (`report_layouts` kind=`MIS`). Not a fixed format.
2. **Commission columns gated `billing.view`** — comp data; field/desk roles without `billing.view` see the MIS *without* money. **Closes G-4.**
3. **Keep the shipped `/billing` page** — the MIS page is **additive**, zero regression.

## 1. The column contract (what "all details" means) — from the V1 audit
V1's operational MIS (`CRM-BACKEND .../reportsController.ts:1837-1879`) is a **34-column, task-grain** XLSX (one row per verification task). It is the de-facto parity target for "case task with all details": task (number/title/type/status/priority/agent/address/pincode/rate-type/amounts/created/started/completed/**TAT**/trigger/applicant-type), the latest form submission (id/type/submitted/validation), the case (number/customer/phone/calling-code/client/code/product/status/priority/created/backend-user), and money (`estimated_amount`/`actual_amount`). V1 gates money columns on a **billing perm** for every money surface *except* this operational MIS (which leaked amounts under `report.generate`) — exactly the gap our G-4 fix closes. V1's reusable engine is the per-(client,product) **data-entry template** (`case_data_templates`/`_fields`/`_entries` + a 36-entry **prefill-source catalog** = the bindable allow-list). v2 already generalized this into `report_layouts`/`report_layout_columns` + the source catalog (below).

**Dropped as legacy cruft (owner-confirmed):** GST invoices subsystem (0 invoices ever in prod), the commission approve→pay ledger (v2 uses a persisted snapshot, not a ledger), MIS-columns-derived-1:1-from-data-entry (v2 columns are independent + bindable).

## 2. What v2 already has (BUILT) — from the v2 design/gap audit
- **Config schema (mig 0060/0064/0066):** `report_layouts` (id, client_id, product_id, `kind`, name, is_active, `version` OCC, audit) — **one active per (client,product,kind)** via `uq_report_layouts_active`; `report_layout_columns` (column_key, header_label, **source_type**, **source_ref**, data_type, display_order, section, is_required, options, validation).
- **Kinds:** `DATA_ENTRY, MIS, BILLING_MIS, FIELD_REPORT, CASE_REPORT`. We consume **`MIS`**. (We do **not** build a separate `BILLING_MIS` page — owner descoped; commission is just money columns inside the MIS layout, gated.)
- **Source catalog (`packages/sdk/src/reportLayouts.ts:32-130`)** with `validateColumnSource` (3 modes): **FIXED** allow-listed — `TASK_FIELD` (16 keys), `CASE_FIELD` (8), `APPLICANT_FIELD` (5); **REFLESS** (ref must be empty) — `RATE_AMOUNT`, `COMMISSION_AMOUNT`, `TAT`; **FREE** (ref *not* allow-listed at config time) — `DATA_ENTRY_FIELD`, `FORM_DATA_PATH`, `DOC_TYPE_COUNT`, `COMPUTED`.
- **Layout lookup:** `reportLayoutRepository.findActiveByConfig(clientId, productId, kind)` returns the active layout + ordered columns, or `null` (a normal "not configured yet").
- **Billing read-model (mig 0079/0080, ADR-0046/0048):** `billing` module + `platform/billing/laterals.ts` — `RATE_LATERAL` (alias `rt`: rate_type, bill_amount), `COMMISSION_LATERAL` (alias `com`: commission_amount), `COMPLETED_BAND` (TAT band). Commission is **persisted** on `case_tasks.commission_amount` (snapshot), read as `COALESCE(ct.commission_amount, com.commission_amount)`. FROM contract = `cases cs` + `case_tasks ct`. **Reuse verbatim — do NOT fork** (the file header + CLAUDE.md forbid it; the FALSE>NULL location-rank bug history proves why).
- **Export engine (`platform/export`):** `ExportColumn<T> = {id, header, value:(row)=>…}`, `toCsv`/`toXlsx` (exceljs), `writeExport`/`exportOrEnqueue` (sync + background-job offload), `assertExportable(count)` row cap, export-audit log line. **Manifest is dynamic-friendly** (plain `{id,header,value}[]`) but **no factory builds one from a layout, and no generation/export endpoint exists.**

## 3. The gap (what we build)
1. **A source resolver** — a closed `source_type → SQL-fragment / value` mapping (the half the catalog promises but never delivers). FIXED → static `Record<key, sqlFragment>`; amounts/TAT → reuse the laterals/`COMPLETED_BAND`; `DATA_ENTRY_FIELD`/`FORM_DATA_PATH`/`DOC_TYPE_COUNT` → **parameter-bound** jsonb/count expressions; `COMPUTED` → resolves to `''` in v1 (no expression compilation).
2. **A task-grain read-model** — a repository query mirroring `billing` (same FROM + laterals + scope predicate), projecting **only the active layout's columns**, paginated, filtered by client+product+completed-date+search.
3. **A dynamic `ExportColumn[]` factory** from the layout columns (money-filtered).
4. **`/api/v2/mis` endpoints** (rows + export) gated `page.mis`; money columns dropped server-side when `!billing.view`; export via the platform engine + `assertExportable` + audit.
5. **Web `/mis` page** — cascading client→product picker + completed-date range + search → table (columns from the layout) + Export. Nav `MIS & Billing` (Layout.tsx:40) → wire to `/mis` (`page.mis`).
6. **RBAC** — new `page.mis` perm (desk roles), seeded into `role_permissions` (mig 0082).

## 4. Security requirements (from the security audit — binding)
The full 16-point checklist is in the audit; the load-bearing ones:
- **R1 Closed resolver grammar.** The SELECT vocabulary is code-owned. FIXED `source_ref` is a *lookup key* into a static map, **never emitted SQL**; unknown key → `''`. (Model on `fieldReports/render.ts:27-41`.)
- **R2 FREE refs are bound parameters, never interpolated.** `DATA_ENTRY_FIELD` → `de.data ->> $n`; `FORM_DATA_PATH` → JS `walkPath` over `form_data` (like `fieldReports/render.ts:14-23`) **or** `#>> $n::text[]` with the split path bound; `DOC_TYPE_COUNT` → correlated count with `doc_type_code = $n` (+ shape-validate ref `^[A-Z][A-Z0-9_]{1,31}$`). `COMPUTED` → `''` (no `eval`, no free SQL).
- **R3 Per-column money gating, server-side, at generation AND export.** Compute `canViewBilling = grantsAll || perms.includes('billing.view')` (mirror `tasks/controller.ts:14-19`); when false, **drop** `RATE_AMOUNT`/`COMMISSION_AMOUNT` columns from the resolved set, the SQL, and the `ExportColumn[]` (mirror `tasks/service.ts:58,70-74`); **omit the laterals** when no money column survives. Reuse `RATE_LATERAL`/`COMMISSION_LATERAL` verbatim. **(Closes G-4.)**
- **R4 Scope-enforce every query** via `resolveScope(actor)` + the task/case scope predicate (mirror `billing/service.ts:59`, `billing/repository.ts:19-27,98`); fail-closed; out-of-scope/absent → **404 not 403**; `clientId`/`productId` are the *layout selector*, **not** authorization (the CLIENT/PRODUCT scope legs still bound rows). Coerce params with `toPosInt`.
- **R5 Export safety.** Route only through `writeExport`/`exportOrEnqueue` (never hand-roll a file); `assertExportable` on the `all` path; `LIMIT` the list; export-audit line `resource:'mis'` + real `actorId`; never log cell values (PII: PAN/mobile/address).
- **R6 (new gap G-9) XLSX formula injection.** `escapeCsvCell` (`format.ts:40-45`) protects CSV but **`toXlsx` (`format.ts:55-69`) does not** — MIS carries attacker-influenceable free text (`form_data`, `DATA_ENTRY_FIELD`, remark/address). Fix the XLSX path to neutralize leading `= + - @ \t \r` (or write cells as text). Platform-wide latent gap; MIS makes it exploitable.

## 5. COMPLIANCE §G dispositions
- **G-4** (RATE_AMOUNT/COMMISSION_AMOUNT ungated at generation) → **being FIXED by this build** (R3, ADR-0049). Update to ✅ FIXED when shipped.
- **G-9 (NEW)** — `toXlsx` omits the CSV formula-escape (`platform/export/format.ts:55-69`) → **being FIXED by this build** (R6). Latent across all XLSX exports; MIS introduces attacker-influenceable text.

## 6. Architecture decision (→ ADR-0049)
**The MIS read-model is a repository read-model mirroring `billing`/pipeline (reusing `platform/billing/laterals.ts` + the scope predicate), NOT a hand-rolled `v_` view.** ADR-0010 prefers `v_`/`mv_` for reporting, but (a) the projection is **per-layout dynamic** — a fixed view can't express it; (b) embedding the laterals into a view migration would **fork** the amount SQL (forbidden, no-fork rule + CLAUDE.md "raw SQL only in repositories + migrations"); (c) the shipped `billing`/pipeline/tasks **task-grain money read-models are already repositories, not views** (accepted precedent). SQL still lives only in the repository layer (ADR-0010's actual intent — no SQL sprawl in app code), reuses shared constants, and is scope-enforced. Documented + locked in ADR-0049.
