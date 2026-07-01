> **SUPERSEDED by [ADR-0083](../adr/ADR-0083-remove-mis-report-layout-engine.md) (2026-07-01)** — the `/mis` page + MIS engine were removed (mig 0108). Historical plan only; not a live build target.

# MIS Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a config-driven, pure-MIS page — case-task rows with all the columns an admin configured in the active `MIS` layout for a (client, product), including the commission rate (gated `billing.view`), exportable as an XLSX/CSV report.

**Architecture:** A new additive `/api/v2/mis` module mirroring the shipped `billing` module: a code-owned **source resolver** maps each `report_layout_columns` row to a safe SQL fragment; a **repository read-model** projects only the active layout's columns over the billing FROM (reusing `RATE_LATERAL`/`COMMISSION_LATERAL`/`COMPLETED_BAND` + the scope predicate); a **service** drops money columns server-side when the actor lacks `billing.view`; **export** flows through the platform engine. A new `page.mis` permission gates the page; the nav item + an `/mis` web page consume the SDK. See `docs/specs/2026-06-19-mis-page-design.md` + ADR-0049.

**Tech Stack:** Node 24, pnpm monorepo, Express + `pg`, TypeScript, Zod, React + MUI DataGrid, exceljs (existing export engine), Vitest.

**Conventions:** Integration tests need `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/crm2_test` + `LC_ALL=C`. Commit author `Mayur Kulkarni <mayurkulkarni786@gmail.com>`, conventional commits, NO AI/Co-Authored-By trailer, never `--no-verify`. Commit only at green sub-steps. `pnpm verify` = typecheck→lint→format→no-suppressions→boundaries→test→build.

---

## Task 1: Platform XLSX formula-escape (closes G-9)

**Files:**
- Modify: `apps/api/src/platform/export/format.ts` (`toXlsx`, ~`:55-69`; reuse `escapeCsvCell` `:40-45`)
- Test: `apps/api/src/platform/export/__tests__/format.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test** — a row whose cell starts with `=`, `+`, `-`, `@` must be neutralized in BOTH csv and xlsx output.

```ts
import { describe, it, expect } from 'vitest';
import { toCsv, toXlsx } from '../format.js';
const cols = [{ id: 'a', header: 'A', value: (r: { a: string }) => r.a }];
const rows = [{ a: '=HYPERLINK("http://x")' }, { a: '+1' }, { a: '-2' }, { a: '@cmd' }, { a: 'ok' }];

describe('export formula-injection guard', () => {
  it('csv prefixes formula-leading cells with a quote', () => {
    const csv = toCsv(rows, cols);
    expect(csv).toContain(`"'=HYPERLINK`); // already passing — regression guard
  });
  it('xlsx neutralizes formula-leading cells (no live formula)', async () => {
    const buf = await toXlsx(rows, cols);
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0]!;
    const c = ws.getCell('A2').value; // first data row
    // neutralized: stored as text starting with apostrophe-guard, never an object {formula}
    expect(typeof c === 'object' && c !== null && 'formula' in (c as object)).toBe(false);
    expect(String(c).startsWith("'=") || String(c) === "=HYPERLINK(\"http://x\")").toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify the xlsx test FAILS** — `cd apps/api && DATABASE_URL=… LC_ALL=C pnpm vitest run src/platform/export/__tests__/format.test.ts`. Expected: csv passes, xlsx fails (raw `=` is stored as a formula object by exceljs).

- [ ] **Step 3: Implement** — in `toXlsx`, run each cell value through the same leading-char guard before writing. Minimal: extract the guard from `escapeCsvCell` into a shared `neutralizeFormula(v: unknown): unknown` (string in → guarded string; non-string passthrough) and apply it in both `toCsv` (via `escapeCsvCell`) and `toXlsx`'s cell write. Keep numbers/dates as native types (only guard strings whose first char ∈ `= + - @ \t \r`).

- [ ] **Step 4: Run, verify PASS** (both tests).

- [ ] **Step 5: Commit** — `feat(export): neutralize formula-leading cells in XLSX output (CWE-1236, closes G-9)`.

---

## Task 2: `page.mis` permission + role seed (mig 0082)

**Files:**
- Modify: `packages/access/src/permissions.ts` (PERMISSIONS, ROLE_PERMISSIONS, PERMISSION_META)
- Create: `db/v2/migrations/0082_mis_permission.sql`
- Test: the existing roles-seed parity test (find it: `grep -rl "ROLE_PERMISSIONS" apps/api/src --include=*.test.ts`)

- [ ] **Step 1: Add the permission constant + meta + role grants.**
  - `MIS_VIEW: 'page.mis',` under the `// billing` / operations group in `PERMISSIONS`.
  - `'page.mis': { label: 'MIS — View', group: 'Operations' },` in `PERMISSION_META`.
  - Add `PERMISSIONS.MIS_VIEW` to `ROLE_PERMISSIONS` for `MANAGER`, `TEAM_LEADER`, `BACKEND_USER` (SUPER_ADMIN already via `Object.values`).

- [ ] **Step 2: Run the parity test, verify it now expects the seed** — `pnpm -C apps/api vitest run <roles-seed parity test>`. If it asserts the constant ≡ DB seed, it will fail until the migration seeds it (Step 3). Expected: FAIL pointing at the missing `page.mis` rows.

- [ ] **Step 3: Write migration `0082_mis_permission.sql`** — idempotent seed into `role_permissions` for the 3 roles (match the existing perm-seed migration style; `grep -rl "INSERT INTO role_permissions" db/v2/migrations | tail -1` for the template):

```sql
-- 0082_mis_permission.sql — ADR-0049: page.mis gates the MIS report page (desk roles).
INSERT INTO role_permissions (role, permission)
SELECT r.role, 'page.mis'
FROM (VALUES ('MANAGER'), ('TEAM_LEADER'), ('BACKEND_USER')) AS r(role)
ON CONFLICT DO NOTHING;
```
(Adjust column names/PK to the actual `role_permissions` schema — `grep -A6 "CREATE TABLE role_permissions" db/v2/migrations/*.sql`.)

- [ ] **Step 4: Apply to the test DB + run the parity test, verify PASS.** Apply per the repo's migrate runner (`grep -rl "migrate" package.json apps/api/package.json` for the script), or psql the file into `crm2_test`.

- [ ] **Step 5: Commit** — `feat(access): page.mis permission + role seed (ADR-0049, mig 0082)`.

---

## Task 3: Source resolver (`mis/resolver.ts`) — unit-tested, injection-safe

**Files:**
- Create: `apps/api/src/modules/mis/resolver.ts`
- Test: `apps/api/src/modules/mis/__tests__/resolver.test.ts`

The resolver is pure: given the active layout's columns + a shared `params` array, it returns the SELECT fragments (aliased `c0,c1,…`), the set of required joins, and the FE column descriptors. **The SELECT vocabulary is code-owned; `source_ref` is never interpolated** (ADR-0049 R1/R2).

- [ ] **Step 1: Write the failing tests.**

```ts
import { describe, it, expect } from 'vitest';
import { resolveColumns } from '../resolver.js';
import type { ReportLayoutColumn } from '@crm2/sdk';

const col = (o: Partial<ReportLayoutColumn>): ReportLayoutColumn =>
  ({ id: 1, column_key: 'k', header_label: 'H', source_type: 'TASK_FIELD',
     source_ref: null, data_type: 'TEXT', display_order: 0, section: null,
     is_required: false, options: [], validation: {}, ...o }) as ReportLayoutColumn;

describe('resolveColumns', () => {
  it('maps a FIXED TASK_FIELD via the static map (key is a lookup, not SQL)', () => {
    const r = resolveColumns([col({ source_type: 'TASK_FIELD', source_ref: 'task_number' })], []);
    expect(r.selects[0]).toBe('ct.task_number AS "c0"');
    expect(r.columns[0]).toMatchObject({ key: 'c0', header: 'H', dataType: 'TEXT' });
  });
  it('unknown FIXED ref resolves to NULL, never emits the ref', () => {
    const r = resolveColumns([col({ source_type: 'TASK_FIELD', source_ref: "x'; DROP TABLE" })], []);
    expect(r.selects[0]).toBe('NULL AS "c0"');
  });
  it('DATA_ENTRY_FIELD binds the ref as a parameter (no interpolation)', () => {
    const params: unknown[] = [];
    const r = resolveColumns([col({ source_type: 'DATA_ENTRY_FIELD', source_ref: "evil'--" })], params);
    expect(r.selects[0]).toBe('de.data ->> $1 AS "c0"');
    expect(params).toEqual(["evil'--"]);
    expect(r.needsDataEntry).toBe(true);
  });
  it('FORM_DATA_PATH binds the split path as a text[] parameter', () => {
    const params: unknown[] = [];
    const r = resolveColumns([col({ source_type: 'FORM_DATA_PATH', source_ref: 'residence.address.line1' })], params);
    expect(r.selects[0]).toBe('ct.form_data #>> $1::text[] AS "c0"');
    expect(params).toEqual([['residence', 'address', 'line1']]);
  });
  it('amount + TAT use the laterals/band; flags requested', () => {
    const r = resolveColumns([
      col({ source_type: 'RATE_AMOUNT' }), col({ source_type: 'COMMISSION_AMOUNT' }), col({ source_type: 'TAT' }),
    ], []);
    expect(r.selects[0]).toBe('rt.bill_amount AS "c0"');
    expect(r.selects[1]).toBe('COALESCE(ct.commission_amount, com.commission_amount) AS "c1"');
    expect(r.selects[2]).toContain('AS "c2"'); // COMPLETED_BAND
    expect(r.needsRate && r.needsCommission).toBe(true);
  });
  it('COMPUTED and DOC_TYPE_COUNT resolve to NULL in v1', () => {
    const r = resolveColumns([col({ source_type: 'COMPUTED', source_ref: 'whatever' }),
                              col({ source_type: 'DOC_TYPE_COUNT', source_ref: 'AADHAAR' })], []);
    expect(r.selects).toEqual(['NULL AS "c0"', 'NULL AS "c1"']);
  });
  it('APPLICANT_FIELD maps to ap.* and flags the join', () => {
    const r = resolveColumns([col({ source_type: 'APPLICANT_FIELD', source_ref: 'pan' })], []);
    expect(r.selects[0]).toBe('ap.pan AS "c0"');
    expect(r.needsApplicant).toBe(true);
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (`resolveColumns` undefined).

- [ ] **Step 3: Implement `resolver.ts`.** Static maps (confirmed columns):

```ts
import type { ReportLayoutColumn, ColumnDataType } from '@crm2/sdk';

const TASK_FIELD_SQL: Record<string, string> = {
  task_number: 'ct.task_number', status: 'ct.status', visit_type: 'ct.visit_type',
  distance_band: 'ct.distance_band', bill_count: 'ct.bill_count',
  verification_outcome: 'ct.verification_outcome', remark: 'ct.remark',
  task_origin: 'ct.task_origin', priority: 'ct.priority', address: 'ct.address',
  trigger: 'ct.trigger', started_at: 'ct.started_at', completed_at: 'ct.completed_at',
  created_at: 'ct.created_at', assignee_name: 'au.name', unit_name: 'vu.name',
};
const CASE_FIELD_SQL: Record<string, string> = {
  case_number: 'cs.case_number', client_name: 'cl.name', product_name: 'p.name',
  backend_contact_number: 'cs.backend_contact_number', case_outcome: 'cs.verification_outcome',
  case_result_remark: 'cs.result_remark', case_completed_at: 'cs.completed_at',
  case_created_at: 'cs.created_at',
};
const APPLICANT_FIELD_SQL: Record<string, string> = {
  name: 'ap.name', mobile: 'ap.mobile', pan: 'ap.pan',
  applicant_type: 'ap.applicant_type', calling_code: 'ap.calling_code',
};
// reuse — import from billing repo (do NOT fork)
import { COMPLETED_BAND } from '../billing/repository.js'; // export it from there (Step 3a)

export interface MisColumnDesc { key: string; header: string; dataType: ColumnDataType }
export interface ResolvedColumns {
  selects: string[]; columns: MisColumnDesc[];
  needsApplicant: boolean; needsDataEntry: boolean; needsRate: boolean; needsCommission: boolean;
}

const PATH_SEG = /^[^\s]{1,64}$/; // non-empty, no whitespace, bounded

export function resolveColumns(cols: ReportLayoutColumn[], params: unknown[]): ResolvedColumns {
  const r: ResolvedColumns = { selects: [], columns: [], needsApplicant: false,
    needsDataEntry: false, needsRate: false, needsCommission: false };
  cols.forEach((col, i) => {
    const alias = `c${i}`;
    const ref = col.source_ref?.trim() ?? '';
    let sql = 'NULL';
    switch (col.source_type) {
      case 'TASK_FIELD': sql = TASK_FIELD_SQL[ref] ?? 'NULL'; break;
      case 'CASE_FIELD': sql = CASE_FIELD_SQL[ref] ?? 'NULL'; break;
      case 'APPLICANT_FIELD':
        sql = APPLICANT_FIELD_SQL[ref] ?? 'NULL';
        if (sql !== 'NULL') r.needsApplicant = true; break;
      case 'RATE_AMOUNT': sql = 'rt.bill_amount'; r.needsRate = true; break;
      case 'COMMISSION_AMOUNT':
        sql = 'COALESCE(ct.commission_amount, com.commission_amount)'; r.needsCommission = true; break;
      case 'TAT': sql = COMPLETED_BAND; break;
      case 'DATA_ENTRY_FIELD':
        if (ref) { params.push(ref); sql = `de.data ->> $${params.length}`; r.needsDataEntry = true; }
        break;
      case 'FORM_DATA_PATH': {
        const segs = ref.split('.').map((s) => s.trim());
        if (segs.length && segs.every((s) => PATH_SEG.test(s))) {
          params.push(segs); sql = `ct.form_data #>> $${params.length}::text[]`;
        }
        break;
      }
      case 'DOC_TYPE_COUNT': // v1: deferred (no documents table confirmed) — resolve NULL
      case 'COMPUTED':       // v1: no expression compilation (ADR-0049)
      default: sql = 'NULL';
    }
    r.selects.push(`${sql} AS "${alias}"`);
    r.columns.push({ key: alias, header: col.header_label, dataType: col.data_type });
  });
  return r;
}
```
  - **Step 3a:** `export const COMPLETED_BAND` in `apps/api/src/modules/billing/repository.ts` (it's currently module-local) so the resolver reuses it without forking. Verify the billing tests still pass after exporting.

- [ ] **Step 4: Run, verify PASS** (all resolver tests).

- [ ] **Step 5: Commit** — `feat(mis): source resolver (code-owned grammar, bound FREE refs, ADR-0049)`.

---

## Task 4: MIS repository + service (read-model, gating, scope) — integration-tested

**Files:**
- Create: `apps/api/src/modules/mis/repository.ts`, `apps/api/src/modules/mis/service.ts`
- Test: `apps/api/src/modules/mis/__tests__/mis.api.test.ts`

- [ ] **Step 1: Write the failing integration tests** (mirror `billing/__tests__/billing.api.test.ts` setup — seed a client+product, an active `MIS` layout with a TASK_FIELD + RATE_AMOUNT + COMMISSION_AMOUNT column, a completed task with a commission). Assert:
  - `GET /api/v2/mis/rows?clientId&productId` as a **billing.view** actor → `columns` includes the money columns; `rows[0]` carries the resolved amounts equal to the billing read-model's.
  - Same as a **non-billing.view** actor (e.g. TEAM_LEADER token) → `columns` EXCLUDE `RATE_AMOUNT`/`COMMISSION_AMOUNT`; rows carry no money aliases. **(G-4)**
  - No active MIS layout for the CPV → `{ columns: [], rows: [], totalCount: 0 }` (200, not 404/500).
  - An out-of-scope actor → `totalCount: 0` rows (not 403).
  - `completedFrom/To` + `search` filter the rows.

- [ ] **Step 2: Run, verify FAIL** (routes not mounted yet — expected 404; write Task 5 stub or assert at the service layer first).

- [ ] **Step 3: Implement `repository.ts`** — `misRows(o)` mirroring `billing.listCases`: build `params`, the SELECT from `resolved.selects`, the FROM (always `case_tasks ct JOIN cases cs JOIN clients cl JOIN products p JOIN verification_units vu ON vu.id = ct.verification_unit_id LEFT JOIN users au ON au.id = ct.assigned_to`; `+ LEFT JOIN case_applicants ap ON ap.id = ct.applicant_id` when `needsApplicant`; `+ LEFT JOIN case_data_entries de ON de.case_id = cs.id` when `needsDataEntry`; `+ RATE_LATERAL` when `needsRate`; `+ COMMISSION_LATERAL` when `needsCommission`), the WHERE (reuse the billing filter shape: `ct.status='COMPLETED'` + clientId + productId + completedFrom/To + search ILIKE on case_number/applicant/task_number + the **scope predicate** — copy `billing/repository.ts`'s `caseScopePredicate`/`composeScopePredicate('CASE')`), `ORDER BY ct.completed_at DESC, ct.id DESC`, `LIMIT/OFFSET`. Return `{ rows, totalCount }`. A `count(*)` query for totalCount (no GROUP BY — this is task grain, one row per task).

- [ ] **Step 4: Implement `service.ts`** — `misRows(actor, query)`:
  - `canViewBilling = actor.grantsAll === true || (actor.permissions ?? []).includes(PERMISSIONS.BILLING_VIEW)`.
  - `findActiveByConfig(clientId, productId, 'MIS')`; `null` → return empty result.
  - `let cols = layout.columns;` then `if (!canViewBilling) cols = cols.filter(c => c.source_type !== 'RATE_AMOUNT' && c.source_type !== 'COMMISSION_AMOUNT');`
  - `const params: unknown[] = []; const resolved = resolveColumns(cols, params);`
  - `resolveScope(actor)` → pass to the repo; `toPosInt` the client/product params; default/clamp limit (reuse the billing PageSpec/pagination).
  - Return `{ columns: resolved.columns, rows, totalCount }`.

- [ ] **Step 5: Run, verify PASS** (after Task 5 mounts the routes, re-run; or run service-level tests now).

- [ ] **Step 6: Commit** — `feat(mis): read-model + service (per-column billing.view gating, scope-enforced; closes G-4)`.

---

## Task 5: Routes + controller + SDK + OpenAPI

**Files:**
- Create: `apps/api/src/modules/mis/controller.ts`, `apps/api/src/modules/mis/routes.ts`
- Modify: `apps/api/src/app.ts` (mount `/api/v2/mis`)
- Create: `packages/sdk/src/mis.ts`; Modify: `packages/sdk/src/client.ts`, `packages/sdk/src/index.ts`
- Test: `packages/sdk/src/client.test.ts` (coverage gate); regen `apps/api/.../openapi.json`

- [ ] **Step 1: Write the failing SDK client test** — assert `client.mis.rows({clientId,productId})` calls `GET /api/v2/mis/rows?...` and `client.mis.export({...}, 'xlsx')` hits `/api/v2/mis/export?...&format=xlsx` (mirror the existing billing client test).

- [ ] **Step 2: Run, verify FAIL.**

- [ ] **Step 3: Implement** the controller (`rows`, `export`), routes (`GET /rows` + `GET /export`, both `authorize(PERMISSIONS.MIS_VIEW)`), mount in `app.ts`. Export: build the `ExportColumn[]` from `resolved.columns` (`{id: c.key, header: c.header, value: r => r[c.key]}`), `assertExportable(totalCount)`, stream via `writeExport` with `resource:'mis'` + `req.auth.userId`. The export reuses the SAME service path (money already dropped for non-billing.view). Add the SDK `mis` namespace + types (`MisColumn`, `MisRowsResponse`, `MisQuery`). Regenerate OpenAPI: `pnpm -C apps/api openapi` (or the repo's `pnpm openapi`).

- [ ] **Step 4: Run, verify PASS** (sdk client test + the Task-4 api tests now green via routes).

- [ ] **Step 5: Commit** — `feat(mis): /api/v2/mis routes + SDK + OpenAPI (rows + export)`.

---

## Task 6: Web MIS page + nav + route

**Files:**
- Create: `apps/web/src/features/mis/MisPage.tsx`
- Modify: `apps/web/src/App.tsx` (route `/mis`, gated `page.mis`), `apps/web/src/components/Layout.tsx:40`
- Test: follow the web test pattern of `BillingPage` if one exists (else rely on e2e + browser-verify)

- [ ] **Step 1: Wire nav + route.** `Layout.tsx:40` → `{ label: 'MIS', to: '/mis', perm: 'page.mis' }`. `App.tsx` → lazy route `/mis` rendering `MisPage`, guarded by the same perm-gate wrapper the other pages use.

- [ ] **Step 2: Build `MisPage.tsx`** — cascading client→product picker (reuse the picker used by `BillingPage`/`ReportLayoutsPage`), completed-date-range + search inputs, a **Generate** button calling `sdk.mis.rows`. Render an MUI **DataGrid** whose `columns` come from `response.columns` (`{ field: col.key, headerName: col.header }`) and rows keyed by `col.key` (add a synthetic `id` per row for the grid). **Export** button → `sdk.mis.export(query, 'xlsx')` (download). Empty-state card when `columns.length === 0` ("No MIS layout configured for this client + product — configure one in MIS Layouts").

- [ ] **Step 3: Typecheck + build the web app** — `pnpm -C apps/web typecheck && pnpm -C apps/web build`. Expected: clean.

- [ ] **Step 4: Commit** — `feat(web): MIS report page + nav + route (page.mis)`.

---

## Task 7: Full verification

- [ ] **Step 1: `pnpm verify`** at the repo root with a sentinel — `pnpm verify; echo "EXIT=$?"`. Must be `EXIT=0` (don't trust `| tail`). Fix anything red.
- [ ] **Step 2: Coverage** — confirm the SDK coverage gate is green (the `mis` client methods are covered by Task 5).
- [ ] **Step 3: CI** — after push (owner OK), confirm the `ci` workflow (e2e/a11y) is green; a green local `pnpm verify` can still red CI.
- [ ] **Step 4: Live browser-verify** (`feedback_browser_verify_perform_actions`) — open `/mis`, generate for a real client+period, confirm columns match the configured layout + the commission equals the billing value, export the XLSX, and confirm a non-`billing.view` role sees no money columns. Capture a screenshot.
- [ ] **Step 5: Close-out** — flip G-4 + G-9 to ✅ FIXED in `docs/COMPLIANCE_GAPS_REGISTRY.md`; update memory (`MEMORY.md` index + a `project_mis_page_2026_06_19.md`).

---

## Self-review notes
- **Spec coverage:** Task 1↔§3/G-9; Task 2↔§4 RBAC; Task 3↔§2.1 resolver; Task 4↔§2.2/2.3 read-model+gating (G-4); Task 5↔§2.4/§5 routes+SDK; Task 6↔§6 web; Task 7↔§7 acceptance. ✅
- **Deferred (v1):** `DOC_TYPE_COUNT` + `COMPUTED` → NULL (no documents table confirmed; no expression compilation). Owner can request `DOC_TYPE_COUNT` wiring later once the doc/photo source is confirmed.
- **Don't-regress:** reuse `RATE_LATERAL`/`COMMISSION_LATERAL`/`COMPLETED_BAND` (no fork); money gating is server-side at generation AND export; `source_ref` never interpolated; scope predicate on every query; out-of-scope → 0 rows / 404, never 403.
