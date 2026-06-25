# Rate-Type Management — Phase A Implementation Plan (catalog + admin CRUD)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the orphaned `rate_types` catalog (mig 0014) into a fully manageable master-data entity: extend its schema (name/description/category/version), give it full CRUD over `/api/v2/rate-types`, and an inline-grid admin page at `/admin/rate-types` — all 18 seeded codes + a new OFFICE row, editable. **No FK/resolution changes in this phase** (that is Phase C).

**Architecture:** Mirror the established `designations` master-data pattern end-to-end (migration → SDK contract → repository → service → controller/routes → inline-grid web page), since `rate_types` is the same shape (code-keyed lookup with is_active + effective_from + OCC version). The only structural difference: `code` is the **immutable** identity (it becomes the FK key in Phase C), whereas designations' `name` is editable.

**Tech Stack:** Node 24, Express + raw `pg` (repository pattern), Zod via `@crm2/sdk`, React + TanStack Query + the in-house `DataGrid` (inline-grid, ADR-0051), Vitest (api integration on Postgres `:5433`), Playwright e2e.

**Spec:** [`docs/specs/2026-06-25-rate-type-management-design.md`](./../specs/2026-06-25-rate-type-management-design.md). **Phase scope:** owner-approved phased ship; this plan is Phase A only. Phases B (assignment) and C (FK conversion) get their own plans after A ships.

---

## File Structure (Phase A)

| File | Create/Modify | Responsibility |
|---|---|---|
| `docs/adr/ADR-0064-rate-type-management.md` | Create | The superseding decision record (catalog as managed FK SoT; supersedes ADR-0050 §client-label, relates ADR-0056). |
| `docs/adr/README.md` | Modify | Index ADR-0064. |
| `db/v2/migrations/0092_rate_type_management.sql` | Create | Extend `rate_types` (+name/description/category/version), backfill name, insert OFFICE. Idempotent. |
| `apps/api/src/platform/__tests__/migrations.rerun.test.ts` | Modify | Assert the new columns + OFFICE row survive a 3× re-run (no resurrection risk in A, but lock it in). |
| `packages/sdk/src/rateTypes.ts` | Modify | Extend `RateType`; add `RATE_TYPE_CATEGORIES`/`RateTypeCategory`, `RateTypeOption`, `Create/UpdateRateTypeSchema`. |
| `packages/sdk/src/index.ts` | Modify (if needed) | Re-export the new schema symbols (match how `designations` is exported). |
| `apps/api/src/modules/rateTypes/repository.ts` | Modify | Add paginated `list`, `options`, `findById`, `create`, `update` (OCC), `setActive`. Mirror `designations/repository.ts`; `code` immutable in update. |
| `apps/api/src/modules/rateTypes/service.ts` | Modify | Paginated list resolution (PageSpec sortMap/filterMap) + CRUD pass-through. Mirror `designations/service.ts`. |
| `apps/api/src/modules/rateTypes/controller.ts` | Modify | `list/options/findById/create/update/activate/deactivate`. Mirror `designations/controller.ts` (minus import/export/bulk). |
| `apps/api/src/modules/rateTypes/routes.ts` | Modify | Wire the new routes with `MASTERDATA_VIEW`/`MASTERDATA_MANAGE`. |
| `apps/api/src/modules/rateTypes/__tests__/rateTypes.integration.test.ts` | Create | Integration coverage (list/create/update/activate/OCC/uniqueness/RBAC/code-immutable). Mirror `designations` integration test. |
| `apps/api/openapi.json` (or generated) | Regenerate | `pnpm --filter @crm2/api openapi`; contract test green. |
| `apps/web/src/features/rateTypes/RateTypesPage.tsx` | Create | Inline-grid admin page. Mirror `designations/DesignationsPage.tsx`; `code` column not editable. |
| `apps/web/src/features/rateManagement/RateRecordPage.tsx` | Modify | Point the existing rate-type dropdown query at `/rate-types/options` (GET `/` becomes paginated). |
| `apps/web/src/App.tsx` | Modify | Add `/admin/rate-types` route. |
| `apps/web/src/components/Layout.tsx` | Modify | Add the "Rate Types" nav entry (ADMINISTRATION, `page.masterdata`). |
| `apps/web/e2e/rateTypes.spec.ts` | Create | Inline-grid affordance + edit-persist. Mirror `locations.spec.ts`. |

**Verify env (every api change):** `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/acs_v2_test LC_ALL=C pnpm verify`. Worktree: `/tmp/crm2-ratetype` (branch `feat/rate-type-management`). Browser-verify against worktree web `:5290` → api `:4001` → `crm2_dev` (`:54329`).

---

## Task 1: ADR-0064

**Files:**
- Create: `docs/adr/ADR-0064-rate-type-management.md`
- Modify: `docs/adr/README.md`

- [ ] **Step 1: Write ADR-0064.** Use `docs/adr/_template.md`. Content:
  - **Status:** Accepted · owner-directed 2026-06-25. **Supersedes** ADR-0050 §"`client_rate_type` is a free-text display label" (the value source becomes a managed FK catalog). **Relates** ADR-0056 (task field rate-type stays auto-derived) + ADR-0051 (inline-grid admin pattern). Frozen-area change per `docs/governance/LONG_TERM_PROTECTION.md`.
  - **Decision:** the existing `rate_types` catalog (mig 0014) becomes the managed source of truth for rate types, FK-referenced by `rates`/`commission_rates`/`case_tasks` (Phase C), with a per-(client×product×unit) assignment layer (Phase B). **Resolution preserved**: client bill resolves by location (rate type = FK'd label); commission resolves by rate-type key + location + Universal dims (matching `rate_type_id`); **no** geo/service-zone rules. OFFICE is a catalog row (`category='OFFICE'`). Phased delivery A→B→C; migrations 0092/0093/0094.
  - **Alternatives considered:** (a) keep the catalog orphaned + free-text labels — rejected (owner wants v1 parity + proper ids); (b) full v1 resolution (bill keyed by rate-type + reintroduce `service_zone_rules`) — rejected by owner (preserve current resolution); (c) FK only the client side — rejected (owner wants commission + billing unified).
  - **Consequences:** admin can create/curate rate types; OUTSTATION family becomes selectable; the migration set re-run safety (the 0083 trap) is the load-bearing risk in Phase C.

- [ ] **Step 2: Index it in `docs/adr/README.md`** — add the table row after ADR-0062 (mirror the existing row format; Status `Accepted`, Date `2026-06-25`).

- [ ] **Step 3: Commit**

```bash
git add docs/adr/ADR-0064-rate-type-management.md docs/adr/README.md
git commit -m "docs(adr): ADR-0064 rate-type management (catalog as managed FK SoT)"
```

---

## Task 2: Migration 0092 — extend `rate_types`

**Files:**
- Create: `db/v2/migrations/0092_rate_type_management.sql`
- Modify: `apps/api/src/platform/__tests__/migrations.rerun.test.ts`

- [ ] **Step 1: Extend the re-run guard test (failing first).** In `migrations.rerun.test.ts`, after the existing constraint assertions (line ~74), add:

```ts
    // ADR-0064 Phase A: rate_types gains name/description/category/version and an OFFICE row,
    // and must survive the 3× re-run unchanged (idempotent ADD COLUMN + ON CONFLICT seed).
    const { rows: rtCols } = await pool.query<{ cols: string }>(
      `SELECT string_agg(column_name, ',' ORDER BY column_name) AS cols
         FROM information_schema.columns WHERE table_name = 'rate_types'`,
    );
    for (const c of ['category', 'description', 'name', 'version'])
      expect(rtCols[0]!.cols).toContain(c);
    const { rows: office } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM rate_types WHERE code = 'OFFICE' AND category = 'OFFICE'`,
    );
    expect(office[0]!.n).toBe('1'); // exactly one OFFICE row after three deploys (ON CONFLICT no-dupe)
```

- [ ] **Step 2: Run it to verify it fails**

Run: `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/acs_v2_test LC_ALL=C pnpm --filter @crm2/api test -- migrations.rerun`
Expected: FAIL — `rate_types` has no `category`/`name` column yet (migration not written).

- [ ] **Step 3: Write the migration.** Create `db/v2/migrations/0092_rate_type_management.sql`:

```sql
-- 0092_rate_type_management.sql — ADR-0064 Phase A. Promote the rate_types catalog (mig 0014) to a
-- managed master-data entity: add name/description/category/version, backfill name for the 18 seeds,
-- and add the OFFICE row (desk/location-less commission band). Forward-only, idempotent, re-run-safe.
-- NO FK / resolution changes here (that is Phase C, mig 0094).

BEGIN;

ALTER TABLE rate_types ADD COLUMN IF NOT EXISTS name        varchar(100);
ALTER TABLE rate_types ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE rate_types ADD COLUMN IF NOT EXISTS category    varchar(10) NOT NULL DEFAULT 'FIELD';
ALTER TABLE rate_types ADD COLUMN IF NOT EXISTS version     integer     NOT NULL DEFAULT 1;

-- category CHECK (guarded so the re-run does not error on a duplicate constraint).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_rate_types_category') THEN
    ALTER TABLE rate_types
      ADD CONSTRAINT chk_rate_types_category CHECK (category IN ('FIELD', 'OFFICE'));
  END IF;
END $$;

-- Seed the human label from the code for any row that lacks one (the 18 from mig 0014); admin can edit.
UPDATE rate_types SET name = code WHERE name IS NULL;

-- name is required going forward (now backfilled on every existing row → safe + idempotent).
ALTER TABLE rate_types ALTER COLUMN name SET NOT NULL;

-- OFFICE: the desk/KYC band — location-less commission keys on it (Phase C). Idempotent.
INSERT INTO rate_types (code, name, category, sort_order)
VALUES ('OFFICE', 'Office', 'OFFICE', 5)
ON CONFLICT (code) DO NOTHING;

COMMIT;
```

- [ ] **Step 4: Run the re-run guard to verify it passes**

Run: `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/acs_v2_test LC_ALL=C pnpm --filter @crm2/api test -- migrations.rerun`
Expected: PASS (full set applies 3×; new columns present; exactly one OFFICE row).

- [ ] **Step 5: Commit**

```bash
git add db/v2/migrations/0092_rate_type_management.sql apps/api/src/platform/__tests__/migrations.rerun.test.ts
git commit -m "feat(db): mig 0092 extend rate_types (name/description/category/version + OFFICE) — ADR-0064"
```

---

## Task 3: SDK contract — extend `RateType` + schemas

**Files:**
- Modify: `packages/sdk/src/rateTypes.ts`
- Modify: `packages/sdk/src/index.ts` (only if `rateTypes` symbols aren't already wildcard-exported)
- Test: `packages/sdk/src/__tests__/rateTypes.test.ts` (create; mirror an existing sdk schema test)

- [ ] **Step 1: Write the failing schema test.** Create `packages/sdk/src/__tests__/rateTypes.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CreateRateTypeSchema, UpdateRateTypeSchema, RATE_TYPE_CATEGORIES } from '../rateTypes.js';

describe('RateType schemas', () => {
  it('CreateRateTypeSchema uppercases code + name, defaults category FIELD', () => {
    const r = CreateRateTypeSchema.parse({ code: 'local6', name: 'local six' });
    expect(r.code).toBe('LOCAL6');
    expect(r.name).toBe('LOCAL SIX');
    expect(r.category).toBe('FIELD');
  });
  it('CreateRateTypeSchema rejects an unknown category', () => {
    expect(() => CreateRateTypeSchema.parse({ code: 'X', name: 'X', category: 'NOPE' })).toThrow();
  });
  it('UpdateRateTypeSchema has NO code field (code is immutable)', () => {
    expect('code' in UpdateRateTypeSchema.shape).toBe(false);
  });
  it('exposes the two categories', () => {
    expect(RATE_TYPE_CATEGORIES).toEqual(['FIELD', 'OFFICE']);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @crm2/sdk test -- rateTypes`
Expected: FAIL — `CreateRateTypeSchema`/`RATE_TYPE_CATEGORIES` not exported.

- [ ] **Step 3: Extend `packages/sdk/src/rateTypes.ts`** (mirror `designations.ts` conventions — `toUpper`, `z.string().trim()`):

```ts
import { z } from 'zod';
import { toUpper } from './text.js';

export const RATE_TYPE_CATEGORIES = ['FIELD', 'OFFICE'] as const;
export type RateTypeCategory = (typeof RATE_TYPE_CATEGORIES)[number];

export interface RateType {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: RateTypeCategory;
  sortOrder: number;
  isActive: boolean;
  /** when the row becomes usable (ADR-0017); usable ⇔ isActive AND effectiveFrom <= now(). */
  effectiveFrom: string;
  /** OCC token (ADR-0019); sent back on update, bumped on every successful write. */
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lean shape for a USABLE-only dropdown (active AND in effect). */
export interface RateTypeOption {
  id: number;
  code: string;
  category: RateTypeCategory;
}

const code = z.string().trim().min(1).max(40).transform(toUpper);
const name = z.string().trim().min(1).max(100).transform(toUpper);
const description = z.string().trim().max(2000).transform(toUpper);
const category = z.enum(RATE_TYPE_CATEGORIES);
const sortOrder = z.number().int().min(0);
const isoDate = z.string().datetime();

export const CreateRateTypeSchema = z.object({
  code,
  name,
  description: description.nullable().optional(),
  category: category.default('FIELD'),
  sortOrder: sortOrder.optional(),
  effectiveFrom: isoDate.optional(),
});

/** Update: `code` is IMMUTABLE (it is the FK key in Phase C) — intentionally absent here. */
export const UpdateRateTypeSchema = z.object({
  name,
  description: description.nullable().optional(),
  category,
  sortOrder: sortOrder.optional(),
  effectiveFrom: isoDate.optional(),
});

export type CreateRateTypeInput = z.input<typeof CreateRateTypeSchema>;
export type UpdateRateTypeInput = z.infer<typeof UpdateRateTypeSchema>;
```

(If `packages/sdk/src/index.ts` lists exports explicitly, add the new symbols mirroring the `designations` export line; if it `export *`'s the module, nothing to change.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @crm2/sdk test -- rateTypes && pnpm --filter @crm2/sdk typecheck`
Expected: PASS + typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/rateTypes.ts packages/sdk/src/__tests__/rateTypes.test.ts packages/sdk/src/index.ts
git commit -m "feat(sdk): extend RateType + Create/UpdateRateTypeSchema (code immutable) — ADR-0064"
```

---

## Task 4: API repository — CRUD over `rate_types`

**Files:**
- Modify: `apps/api/src/modules/rateTypes/repository.ts`

Mirror `apps/api/src/modules/designations/repository.ts` (read it first). Deltas: table `rate_types`; identity is `code` (immutable in `update` — do NOT set `code` in the UPDATE); add `category`; conflict code `RATE_TYPE_EXISTS`; not-found `RATE_TYPE_NOT_FOUND`; no department FK.

- [ ] **Step 1: Replace the file body.** Keep the existing `list(activeOnly)` semantics available as `options()`; add the rest:

```ts
import type { RateType, RateTypeOption, RateTypeCategory, SortOrder } from '@crm2/sdk';
import { filterClauses, likeContains, type AppliedFilter } from '../../platform/pagination.js';
import { query, withTransaction } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';

const pgCode = (e: unknown): string | undefined =>
  typeof e === 'object' && e !== null ? (e as { code?: string }).code : undefined;
const UNIQUE_VIOLATION = '23505';

const COLS = `id, code, name, description, category, sort_order, is_active,
  effective_from, version, created_by, updated_by, created_at, updated_at`;

interface CreateRow {
  code: string;
  name: string;
  description?: string | null | undefined;
  category: RateTypeCategory;
  sortOrder?: number | undefined;
  effectiveFrom?: string | undefined;
}
interface UpdateRow {
  name: string;
  description?: string | null | undefined;
  category: RateTypeCategory;
  sortOrder?: number | undefined;
  effectiveFrom?: string | undefined;
}

export interface RateTypeListOptions {
  active?: boolean;
  search?: string;
  columnFilters?: AppliedFilter[];
  ids?: number[];
  sortColumn: string;
  sortOrder: SortOrder;
  limit: number;
  offset: number;
}

const mapWriteError = (e: unknown): never => {
  if (pgCode(e) === UNIQUE_VIOLATION)
    throw AppError.conflict('RATE_TYPE_EXISTS', 'a rate type with this code already exists');
  throw e;
};

export const rateTypeRepository = {
  async list(o: RateTypeListOptions): Promise<{ items: RateType[]; totalCount: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (o.active !== undefined) {
      params.push(o.active);
      where.push(`is_active = $${params.length}`);
      if (o.active) where.push(`effective_from <= now()`);
    }
    if (o.search) {
      params.push(likeContains(o.search));
      where.push(`(code ILIKE $${params.length} OR name ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }
    where.push(...filterClauses(o.columnFilters ?? [], params));
    if (o.ids && o.ids.length) {
      params.push(o.ids);
      where.push(`id = ANY($${params.length})`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const [countRow] = await query<{ count: number }>(
      `SELECT count(*)::int AS count FROM rate_types ${clause}`,
      params,
    );
    const items = await query<RateType>(
      `SELECT ${COLS} FROM rate_types ${clause}
       ORDER BY ${o.sortColumn} ${o.sortOrder}, id ${o.sortOrder}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, o.limit, o.offset],
    );
    return { items, totalCount: countRow?.count ?? 0 };
  },

  /** USABLE rate types for a dropdown (active AND in effect). Replaces the old bare list(). */
  options(activeOnly = true): Promise<RateTypeOption[]> {
    const clause = activeOnly ? 'WHERE is_active AND effective_from <= now()' : '';
    return query<RateTypeOption>(
      `SELECT id, code, category FROM rate_types ${clause} ORDER BY sort_order, code`,
    );
  },

  async findById(id: number): Promise<RateType | null> {
    const rows = await query<RateType>(`SELECT ${COLS} FROM rate_types WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  async create(input: CreateRow, userId: string): Promise<RateType> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<RateType>(
          `INSERT INTO rate_types (code, name, description, category, sort_order, effective_from, created_by, updated_by)
           VALUES ($1, $2, $3, $4, COALESCE($5, 0), COALESCE($6::timestamptz, now()), $7, $7) RETURNING ${COLS}`,
          [input.code, input.name, input.description ?? null, input.category,
           input.sortOrder ?? null, input.effectiveFrom ?? null, userId],
        );
        if (!row) throw AppError.internal('insert returned no row');
        await appendAudit({ entityType: 'rate_types', entityId: row.id, action: 'CREATE',
          actorId: userId, after: row, versionAfter: row.version }, q);
        return row;
      });
    } catch (e) {
      return mapWriteError(e);
    }
  },

  /** OCC-guarded update (ADR-0019). `code` is NOT updatable (it is the FK key). */
  async update(id: number, input: UpdateRow, userId: string, expectedVersion: number, before: RateType): Promise<RateType> {
    try {
      return await withTransaction(async (q) => {
        const [row] = await q<RateType>(
          `UPDATE rate_types SET name = $2, description = $3, category = $4,
                  sort_order = COALESCE($5, sort_order),
                  effective_from = COALESCE($6::timestamptz, effective_from),
                  version = version + 1, updated_by = $7, updated_at = now()
           WHERE id = $1 AND version = $8 RETURNING ${COLS}`,
          [id, input.name, input.description ?? null, input.category,
           input.sortOrder ?? null, input.effectiveFrom ?? null, userId, expectedVersion],
        );
        if (!row) {
          const [current] = await q<RateType>(`SELECT ${COLS} FROM rate_types WHERE id = $1`, [id]);
          if (!current) throw AppError.notFound('RATE_TYPE_NOT_FOUND');
          throw AppError.stale(current);
        }
        await appendAudit({ entityType: 'rate_types', entityId: id, action: 'UPDATE',
          actorId: userId, before, after: row, versionAfter: row.version }, q);
        return row;
      });
    } catch (e) {
      return mapWriteError(e);
    }
  },

  async setActive(id: number, isActive: boolean, userId: string, expectedVersion: number): Promise<RateType> {
    return withTransaction(async (q) => {
      const [before] = await q<RateType>(`SELECT ${COLS} FROM rate_types WHERE id = $1`, [id]);
      if (!before) throw AppError.notFound('RATE_TYPE_NOT_FOUND');
      const [row] = await q<RateType>(
        `UPDATE rate_types SET is_active = $2, version = version + 1, updated_by = $3, updated_at = now()
         WHERE id = $1 AND version = $4 RETURNING ${COLS}`,
        [id, isActive, userId, expectedVersion],
      );
      if (!row) throw AppError.stale(before);
      await appendAudit({ entityType: 'rate_types', entityId: id,
        action: isActive ? 'ACTIVATE' : 'DEACTIVATE', actorId: userId, before, after: row,
        versionAfter: row.version }, q);
      return row;
    });
  },
};
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @crm2/api typecheck`
Expected: PASS (consumers updated in Tasks 5–6).

- [ ] **Step 3: Commit** (with Task 5–6, after the integration test is green — see Task 6).

---

## Task 5: API service — paginated list + CRUD

**Files:**
- Modify: `apps/api/src/modules/rateTypes/service.ts`

Mirror `apps/api/src/modules/designations/service.ts` (read it). It owns: the `PageSpec` (whitelisted `sortMap` + `filterMap` — the SQL-injection-safe sort/filter columns), parsing `req.query` via the shared pagination helper, validating the body with the SDK schemas, and calling the repo. Deltas:

- `sortMap`: `{ code, name, sortOrder: 'sort_order', createdAt: 'created_at', updatedAt: 'updated_at', effectiveFrom: 'effective_from' }`, default sort `sortOrder`.
- `filterMap`: `{ category: 'category', isActive: 'is_active' }`.
- `create(body, userId)` → `repo.create(CreateRateTypeSchema.parse(body), userId)`.
- `update(id, body, userId)` → load `before = repo.findById(id)` (404 `RATE_TYPE_NOT_FOUND` if null), `requireVersion(body)` for the OCC token, `repo.update(id, UpdateRateTypeSchema.parse(body), userId, version, before)`.
- `activate/deactivate(id, version, userId)` → `repo.setActive(...)`.
- `options(activeOnly)` → `repo.options(activeOnly)`.
- **Omit** import/export/bulk for Phase A (YAGNI — add later only if asked).

- [ ] **Step 1: Implement the service** mirroring designations (no new test here — covered by Task 6 integration + Task 3 schema test).
- [ ] **Step 2: Typecheck** — `pnpm --filter @crm2/api typecheck` → PASS.

---

## Task 6: API controller + routes + integration test

**Files:**
- Modify: `apps/api/src/modules/rateTypes/controller.ts`
- Modify: `apps/api/src/modules/rateTypes/routes.ts`
- Create: `apps/api/src/modules/rateTypes/__tests__/rateTypes.integration.test.ts`

- [ ] **Step 1: Write the failing integration test.** Mirror `apps/api/src/modules/designations/__tests__/*.integration.test.ts` (read it for the exact harness: app bootstrap, `authHeaderForRole`, `connectRedis`/disconnect). Cover:

```ts
// (shape — align imports/harness with the designations integration test)
describe('rate-types CRUD (ADR-0064)', () => {
  it('GET /api/v2/rate-types returns the seeded catalog paginated', async () => {
    const res = await request(app).get('/api/v2/rate-types').set(authHeaderForRole('SUPER_ADMIN'));
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(19); // 18 + OFFICE
    expect(res.body.items.some((r: { code: string }) => r.code === 'OFFICE')).toBe(true);
  });

  it('POST creates a rate type (uppercased code), then GET /:id returns it', async () => {
    const res = await request(app).post('/api/v2/rate-types')
      .set(authHeaderForRole('SUPER_ADMIN')).send({ code: 'zztest', name: 'zz test' });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe('ZZTEST');
    expect(res.body.category).toBe('FIELD');
    const get = await request(app).get(`/api/v2/rate-types/${res.body.id}`).set(authHeaderForRole('SUPER_ADMIN'));
    expect(get.body.code).toBe('ZZTEST');
  });

  it('POST a duplicate code → 409 RATE_TYPE_EXISTS', async () => {
    const res = await request(app).post('/api/v2/rate-types')
      .set(authHeaderForRole('SUPER_ADMIN')).send({ code: 'LOCAL', name: 'dup' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('RATE_TYPE_EXISTS');
  });

  it('PUT updates name/category but NOT code; stale version → 409', async () => {
    const created = await request(app).post('/api/v2/rate-types')
      .set(authHeaderForRole('SUPER_ADMIN')).send({ code: 'zzupd', name: 'a' });
    const id = created.body.id;
    const ok = await request(app).put(`/api/v2/rate-types/${id}`)
      .set(authHeaderForRole('SUPER_ADMIN')).send({ name: 'b', category: 'OFFICE', code: 'HACK', version: created.body.version });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('B');
    expect(ok.body.category).toBe('OFFICE');
    expect(ok.body.code).toBe('ZZUPD'); // code ignored — immutable
    const stale = await request(app).put(`/api/v2/rate-types/${id}`)
      .set(authHeaderForRole('SUPER_ADMIN')).send({ name: 'c', category: 'FIELD', version: created.body.version });
    expect(stale.status).toBe(409);
  });

  it('deactivate/activate are version-guarded', async () => {
    const c = await request(app).post('/api/v2/rate-types')
      .set(authHeaderForRole('SUPER_ADMIN')).send({ code: 'zzact', name: 'x' });
    const d = await request(app).post(`/api/v2/rate-types/${c.body.id}/deactivate`)
      .set(authHeaderForRole('SUPER_ADMIN')).send({ version: c.body.version });
    expect(d.status).toBe(200);
    expect(d.body.isActive).toBe(false);
  });

  it('RBAC: a non-masterdata role cannot write', async () => {
    const res = await request(app).post('/api/v2/rate-types')
      .set(authHeaderForRole('FIELD_AGENT')).send({ code: 'zzno', name: 'no' });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/acs_v2_test LC_ALL=C pnpm --filter @crm2/api test -- rateTypes.integration`
Expected: FAIL (routes/controller not implemented; 404s).

- [ ] **Step 3: Implement the controller** (mirror `designations/controller.ts`, drop export/import/bulk):

```ts
import type { Request, Response, NextFunction } from 'express';
import { rateTypeService as svc } from './service.js';
import { AppError } from '../../platform/errors.js';
import { HTTP_STATUS } from '../../platform/http.js';
import { requireVersion } from '../../platform/occ.js';

const parseId = (req: Request): number => {
  const id = Number(req.params['id']);
  if (!Number.isInteger(id) || id <= 0) throw AppError.badRequest('BAD_REQUEST', { param: 'id' });
  return id;
};
const userId = (req: Request): string => req.auth?.userId ?? 'unknown';

export const rateTypeController = {
  async list(req: Request, res: Response, next: NextFunction) {
    try { res.json(await svc.list(req.query as Record<string, unknown>)); } catch (e) { next(e); }
  },
  async options(req: Request, res: Response, next: NextFunction) {
    try { res.json(await svc.options(req.query['active'] !== 'false')); } catch (e) { next(e); }
  },
  async findById(req: Request, res: Response, next: NextFunction) {
    try {
      const row = await svc.findById(parseId(req));
      if (!row) throw AppError.notFound('RATE_TYPE_NOT_FOUND');
      res.json(row);
    } catch (e) { next(e); }
  },
  async create(req: Request, res: Response, next: NextFunction) {
    try { res.status(HTTP_STATUS.CREATED).json(await svc.create(req.body, userId(req))); } catch (e) { next(e); }
  },
  async update(req: Request, res: Response, next: NextFunction) {
    try { res.json(await svc.update(parseId(req), req.body, userId(req))); } catch (e) { next(e); }
  },
  async activate(req: Request, res: Response, next: NextFunction) {
    try { res.json(await svc.activate(parseId(req), requireVersion(req.body), userId(req))); } catch (e) { next(e); }
  },
  async deactivate(req: Request, res: Response, next: NextFunction) {
    try { res.json(await svc.deactivate(parseId(req), requireVersion(req.body), userId(req))); } catch (e) { next(e); }
  },
};
```

- [ ] **Step 4: Implement the routes** (replace `routes.ts`; static `/options` before `/:id`):

```ts
import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { rateTypeController as c } from './controller.js';

/** /api/v2/rate-types — managed rate-type catalog (ADR-0064). View: page.masterdata. Manage: masterdata.manage. */
export const rateTypeRoutes: Router = Router();

rateTypeRoutes.get('/options', authorize(PERMISSIONS.MASTERDATA_VIEW), c.options);
rateTypeRoutes.get('/', authorize(PERMISSIONS.MASTERDATA_VIEW), c.list);
rateTypeRoutes.get('/:id', authorize(PERMISSIONS.MASTERDATA_VIEW), c.findById);
rateTypeRoutes.post('/', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.create);
rateTypeRoutes.put('/:id', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.update);
rateTypeRoutes.post('/:id/activate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.activate);
rateTypeRoutes.post('/:id/deactivate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.deactivate);
```

> Note: `GET /` now returns a **paginated envelope** (was a bare array). The only consumer is `RateRecordPage` — repointed to `/options` in Task 8. The route is already mounted in the app router (mig 0014 era), so no new `app.use(...)` is needed.

- [ ] **Step 5: Run the integration test to verify it passes**

Run: `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/acs_v2_test LC_ALL=C pnpm --filter @crm2/api test -- rateTypes.integration`
Expected: PASS (all cases).

- [ ] **Step 6: Regenerate OpenAPI + run the contract test**

Run: `pnpm --filter @crm2/api openapi && DATABASE_URL=postgresql://postgres@127.0.0.1:5433/acs_v2_test LC_ALL=C pnpm --filter @crm2/api test -- contract`
Expected: new paths present; contract test PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/rateTypes/ apps/api/openapi.json
git commit -m "feat(api): rate-types CRUD (list/get/create/update/activate/deactivate) — ADR-0064"
```

---

## Task 7: Web — Rate Types admin page (inline-grid)

**Files:**
- Create: `apps/web/src/features/rateTypes/RateTypesPage.tsx`
- Modify: `apps/web/src/App.tsx` (route), `apps/web/src/components/Layout.tsx` (nav)
- Modify: `apps/web/src/features/rateManagement/RateRecordPage.tsx` (repoint dropdown to `/options`)

- [ ] **Step 1: Create `RateTypesPage.tsx`** mirroring `designations/DesignationsPage.tsx`. `BASE='/api/v2/rate-types'`, `QK='rate-types'`. RBAC self-guard at top: `const { has } = useAuth(); if (!has('page.masterdata')) return <Navigate to="/" replace/>;`. Columns:

```tsx
// code is the immutable identity → editable ONLY on create (add-row), NOT on existing rows.
{ id: 'code', header: 'Code', sortable: true, filterable: true, cell: (r) => r.code },        // not editable
{ id: 'name', header: 'Name', sortable: true, editable: true, required: true, cell: (r) => r.name },
{ id: 'description', header: 'Description', editable: true,
  cell: (r) => <span className="text-muted-foreground">{r.description ?? ''}</span> },
{ id: 'category', header: 'Category', editable: true, editor: 'select', field: 'category',
  editorOptions: [{ value: 'FIELD', label: 'FIELD' }, { value: 'OFFICE', label: 'OFFICE' }],
  draftValue: (r) => r.category, cell: (r) => r.category },
{ id: 'sortOrder', header: 'Sort', sortable: true, editable: true, field: 'sortOrder',
  draftValue: (r) => String(r.sortOrder), cell: (r) => r.sortOrder },
{ id: 'status', header: 'Status', sortable: true,
  cell: (r) => <StatusChip isActive={r.isActive} effectiveFrom={r.effectiveFrom} /> },
{ id: 'actions', header: 'Actions', align: 'right', editAction: true,
  cell: (r) => <Button variant={r.isActive ? 'destructive' : 'secondary'} size="sm"
    onClick={() => toggle.mutate(r)}>{r.isActive ? 'Deactivate' : 'Activate'}</Button> },
```

`save(row, changed, version)` mirrors Designations but for **create** (add-row) `code` IS required, and on edit `code` is never in `changed` (no editable code column). Map `RATE_TYPE_EXISTS` → "A rate type with this code already exists." The add-row create sends `{ code, name, description, category, sortOrder? }`. `inlineEdit={{ version: (r) => r.version, onSave: save, onCreate: create }}`, `fetchPage` against `BASE`, `defaultSort="sortOrder"`. Drop the `ImportButton`/`exportFn` (not in Phase A).

- [ ] **Step 2: Add the route in `App.tsx`** (alongside the other `/admin/*` master-data routes):

```tsx
<Route path="/admin/rate-types" element={<RateTypesPage />} />
```

- [ ] **Step 3: Add the nav entry in `Layout.tsx`** (ADMINISTRATION array, near "Rate Management"):

```tsx
{ label: 'Rate Types', to: '/admin/rate-types', perm: 'page.masterdata' },
```

- [ ] **Step 4: Repoint `RateRecordPage.tsx`'s dropdown query** from the now-paginated `GET /` to the bare `GET /options`:

```tsx
// was: api<RateType[]>('GET', '/api/v2/rate-types?active=true')
queryFn: () => api<RateTypeOption[]>('GET', '/api/v2/rate-types/options?active=true'),
```

(Adjust the imported type to `RateTypeOption` and the option `.code`/`.id` usage accordingly. This keeps Rate Management working unchanged for the user.)

- [ ] **Step 5: Typecheck + web unit tests + build**

Run: `pnpm --filter @crm2/web typecheck && pnpm --filter @crm2/web test && pnpm --filter @crm2/web build`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/rateTypes/ apps/web/src/App.tsx apps/web/src/components/Layout.tsx apps/web/src/features/rateManagement/RateRecordPage.tsx
git commit -m "feat(web): Rate Types admin page (inline-grid) + nav/route; Rate Mgmt dropdown → /options — ADR-0064"
```

---

## Task 8: e2e + browser-verify + full gate

**Files:**
- Create: `apps/web/e2e/rateTypes.spec.ts`

- [ ] **Step 1: Write the e2e spec** mirroring `apps/web/e2e/locations.spec.ts` (Laptop-only; reuses the seeded catalog — mig 0092 seeds 19 rows in CI, so NO extra `e2e.seed.sql` row is needed). Assert: navigate `/admin/rate-types`; the grid shows the `OFFICE` row; clicking the **Name** cell of a row opens an inline editor (no modal); a `code` cell does **not** open an editor (immutable); "+ Add row" is present.

- [ ] **Step 2: Run the new spec against the worktree web**

Setup (per the verify-infra): kill stray listeners; `PORT=4001 pnpm --filter @crm2/api dev` (worktree api, reads `apps/api/.env` → `crm2_dev` :54329); `pnpm --filter @crm2/web exec vite --port 5290 --strictPort` with `API_URL=http://localhost:4001`; `pnpm exec playwright test e2e/auth.setup.ts --project=setup`.
Run: `cd apps/web && E2E_BASE_URL=http://localhost:5290 pnpm exec playwright test rateTypes --project=Laptop --project=setup`
Expected: PASS.

- [ ] **Step 3: Browser-verify the real action + confirm persistence.** In the worktree web (:5290), log in admin/admin123, go to `/admin/rate-types`: edit a Name cell → Save → reload → persisted; add a new row (code `ZZ_E2E`, name, category) → Save → appears; deactivate it. Confirm in `crm2_dev`:

```bash
docker exec acs_v2_dev_pg psql -U postgres -d crm2_dev -c \
  "SELECT code, name, category, is_active FROM rate_types WHERE code IN ('OFFICE','ZZ_E2E') ORDER BY code;"
```
Then clean up the throwaway row: `... -c "DELETE FROM rate_types WHERE code='ZZ_E2E';"` (and any audit row if needed). Screenshot the page as proof.

- [ ] **Step 4: Full gate**

Run: `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/acs_v2_test LC_ALL=C pnpm verify` (do NOT pipe to `tail` — it masks the exit code), then `cd apps/web && pnpm exec playwright test` (full e2e).
Expected: typecheck 8/8 · lint · format · no-suppressions · boundaries · all tests · build · full e2e all green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/rateTypes.spec.ts
git commit -m "test(e2e): rate-types admin inline-grid affordance + edit-persist — ADR-0064"
```

- [ ] **Step 6: Update memory + registry, then STOP for owner push approval.** Update `project_rate_type_management_2026_06_25.md` (Phase A DONE), and ask the owner before `git push` (→ auto-deploys). Do NOT push without explicit OK.

---

## Self-Review (run after writing the plan)

- **Spec coverage (Phase A subset):** catalog schema extend ✓ (T2), OFFICE + category ✓ (T2/T3), seeded-rows editable + code immutable ✓ (T3 schema, T4 update, T7 column), full CRUD API ✓ (T4–6), RBAC view/manage ✓ (T6), admin inline-grid page ✓ (T7), nav/route ✓ (T7), OpenAPI additive ✓ (T6), re-run safety ✓ (T2), e2e + browser-verify ✓ (T8), ADR ✓ (T1). Phase B/C explicitly deferred to their own plans.
- **Placeholder scan:** none — every code step has real code or an exact template path + named deltas.
- **Type consistency:** `RateType`/`RateTypeOption`/`RateTypeCategory`/`Create|UpdateRateTypeInput` (T3) used consistently in repo (T4), controller/routes (T6), web (T7). `code` immutable enforced in three places (schema T3, SQL T4, column T7). Error codes `RATE_TYPE_EXISTS`/`RATE_TYPE_NOT_FOUND` consistent across T4/T6.
- **Mobile:** untouched in Phase A (no case_tasks/sync change).
