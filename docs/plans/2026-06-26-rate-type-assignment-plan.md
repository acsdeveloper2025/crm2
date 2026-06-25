# Rate-Type Management — Phase B Implementation Plan (per-combination assignment layer)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the v1-style **per-combination assignment** layer on top of the Phase-A `rate_types` catalog: a `rate_type_assignments(client × product × verification_unit → rate_type)` table, a bulk set-the-assigned-set API, a combo→available-rate-types resolver at `GET /api/v2/rate-types/available`, and an admin **matrix page** at `/admin/rate-type-assignments`. **No FK/resolution change** (that is Phase C) — the catalog stays string-valued at the call sites until C.

**Architecture:** Mirror the established master-data module pattern (migration → SDK contract → repository → service → controller/routes → web page), reusing the Phase-A `rateTypes` module as the closest analog. Two structural notes: (1) the assignment row carries **no OCC `version`** — `POST /bulk` is an atomic *replace the active set for a combo* (last-write-wins per combo, fine for an admin config surface); (2) the `available` resolver must be readable by **either** master-data viewers (Rate Management) **or** case creators (case-creation rate-preview) → adds a minimal `authorizeAny(...perms)` to `@crm2/access` (the one shared-package edit; CTO-owned).

**Numbers (owner-confirmed 2026-06-25, collision-proof vs the unpushed `feat/rbac-scope-cluster` branch which already uses ADR-0065/0066):** **ADR-0067**, **migration 0093**. Phase C will be ADR-0068 / mig 0094.

**Spec:** [`docs/specs/2026-06-25-rate-type-management-design.md`](./../specs/2026-06-25-rate-type-management-design.md) §3.2 (data model), §4 (API), §5 (web). **Phase scope:** this plan is Phase B only; Phase C (FK conversion + wiring) gets its own plan after B ships.

**Tech Stack:** Node 24, Express + raw `pg` (repository pattern), Zod via `@crm2/sdk`, React + TanStack Query, Vitest (api integration on Postgres `:5433`), Playwright e2e.

---

## File Structure (Phase B)

| File | Create/Modify | Responsibility |
|---|---|---|
| `docs/adr/ADR-0067-rate-type-assignment.md` | Create | The assignment-layer decision (relates ADR-0064; resolution preserved). |
| `docs/adr/README.md` | Modify | Index ADR-0067. |
| `db/v2/migrations/0093_rate_type_assignments.sql` | Create | `rate_type_assignments` table + UNIQUE + partial index. Idempotent, re-run-safe. |
| `apps/api/src/platform/__tests__/migrations.rerun.test.ts` | Modify | Assert the table + UNIQUE constraint + partial index survive a 3× re-run. |
| `packages/access/src/<authorize file>` + `index.ts` | Modify | Add `authorizeAny(...perms)` (any-of guard) mirroring `authorize`; export it. |
| `packages/access/src/__tests__/*` | Create/Modify | Unit test: `authorizeAny` passes if the user has ANY listed perm or `grantsAll`, 403 otherwise. |
| `packages/sdk/src/rateTypeAssignments.ts` | Create | `RateTypeAssignment` type + `BulkSetRateTypeAssignmentsSchema`. |
| `packages/sdk/src/index.ts` | Modify | Re-export the new module (mirror how `rateTypes` is exported). |
| `packages/sdk/src/__tests__/rateTypeAssignments.test.ts` | Create | Schema test (positive-int ids, array of ids). |
| `apps/api/src/modules/rateTypeAssignments/{repository,service,controller,routes}.ts` | Create | `GET /` list-for-combo + `POST /bulk` set-the-set. |
| `apps/api/src/modules/rateTypeAssignments/__tests__/rateTypeAssignments.integration.test.ts` | Create | Integration: list/bulk/idempotent-replace/RBAC/bad-id. |
| `apps/api/src/modules/rateTypes/{repository,service,controller,routes}.ts` | Modify | Add the `available` resolver (route `/available` BEFORE `/:id`, `authorizeAny(MASTERDATA_VIEW, CASE_CREATE)`). |
| `apps/api/src/modules/rateTypes/__tests__/rateTypes.integration.test.ts` | Modify | Add `available` cases (assigned→returned; both perm classes allowed; combo with no assignment → []). |
| `apps/api/src/http/app.ts` | Modify | `mount('/api/v2/rate-type-assignments', rateTypeAssignmentRoutes)`. |
| `apps/api/openapi.json` | Regenerate | `pnpm --filter @crm2/api openapi`; contract test green. |
| `apps/web/src/features/rateTypeAssignments/RateTypeAssignmentsPage.tsx` | Create | Matrix page: client → product → unit → checkbox list of active rate types → Save (POST bulk). |
| `apps/web/src/App.tsx` | Modify | Add `/admin/rate-type-assignments` route. |
| `apps/web/src/components/Layout.tsx` | Modify | Add the "Rate Type Assignments" nav entry (ADMINISTRATION, `page.masterdata`). |
| `apps/web/e2e/rateTypeAssignments.spec.ts` | Create | Assign a rate type to a combo → Save → reload → persisted. |
| `db/v2/seed/e2e.seed.sql` | Modify (only if needed) | A seed assignment row is NOT needed (the e2e creates its own via the UI; clients/products from the seed + migration-seeded units/rate-types populate the dropdowns). |

**Verify env (every api change):** `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/crm2_test LC_ALL=C pnpm verify` (the `:5433` test DB is **`crm2_test`**, not the stale `acs_v2_test`). Worktree: `/tmp/crm2-rtassign` (branch `feat/rate-type-assignment`, off origin/main `e0b11ab`). Browser-verify against worktree web `:5290` → api `:4001` → `crm2_dev` (`:54329`). Apply mig 0093 to `crm2_dev` manually (idempotent) before browser-verify.

---

## Task 1: ADR-0067

**Files:** Create `docs/adr/ADR-0067-rate-type-assignment.md`; Modify `docs/adr/README.md`.

- [ ] **Step 1: Write ADR-0067** (use `docs/adr/_template.md`):
  - **Status:** Accepted · owner-directed 2026-06-25. **Relates** ADR-0064 (the catalog as managed FK SoT). Frozen-area change (billing/commission data model) per `docs/governance/LONG_TERM_PROTECTION.md`.
  - **Decision:** add `rate_type_assignments(client_id, product_id, verification_unit_id, rate_type_id, is_active)` declaring which catalog rate types are available per (client × product × verification unit). Maintained via a **bulk set-the-set** API (no per-row OCC) and surfaced by `GET /api/v2/rate-types/available?clientId&productId&verificationUnitId`. **Resolution preserved** — the assignment only **bounds availability** at the Rate-Management / case-creation pickers (wired in Phase C); it does **not** change how the client bill (by location) or commission (key + location + Universal dims) resolve. The **Commission picker stays ALL active catalog rows** (commission dims are Universal-able, not combo-gated — owner 2026-06-25). Adds `authorizeAny` (any-of RBAC guard) so `available` is reachable by master-data viewers and case creators alike.
  - **Alternatives considered:** (a) per-row CRUD with OCC instead of bulk-set — rejected (a checkbox matrix is naturally a set replace; per-row OCC adds churn with no admin benefit); (b) combo-gate the Commission picker too — rejected by owner (commission dims are Universal); (c) reintroduce v1 `service_zone_rules` (geo→rate-type) — out of scope per ADR-0064 (resolution preserved).
  - **Consequences:** admins curate availability per combo; Rate Management's rate-type picker becomes assignment-gated in Phase C; an unassigned combo resolves to an empty available-set (so admins must assign before a rate/commission can reference it there).
- [ ] **Step 2: Index it in `docs/adr/README.md`** — add the row after ADR-0066 (Status `Accepted`, Date `2026-06-25`).
- [ ] **Step 3: Commit** — `docs(adr): ADR-0067 rate-type per-combination assignment layer`

---

## Task 2: Migration 0093 — `rate_type_assignments`

**Files:** Create `db/v2/migrations/0093_rate_type_assignments.sql`; Modify `apps/api/src/platform/__tests__/migrations.rerun.test.ts`.

- [ ] **Step 1: Extend the re-run guard test (failing first).** After the Phase-A rate_types block, assert the new table + constraint + index exist after the 3× apply:

```ts
    // ADR-0067 Phase B: rate_type_assignments must survive the 3× re-run (idempotent CREATE/constraint/index).
    const { rows: rta } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM information_schema.tables WHERE table_name = 'rate_type_assignments'`,
    );
    expect(rta[0]!.n).toBe('1');
    const { rows: uq } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_constraint WHERE conname = 'uq_rate_type_assignment'`,
    );
    expect(uq[0]!.n).toBe('1');
    const { rows: idx } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM pg_indexes WHERE indexname = 'idx_rta_combo'`,
    );
    expect(idx[0]!.n).toBe('1');
```

- [ ] **Step 2: Run it → FAIL** (`pnpm --filter @crm2/api test -- migrations.rerun`).

- [ ] **Step 3: Write the migration** `db/v2/migrations/0093_rate_type_assignments.sql`:

```sql
-- 0093_rate_type_assignments.sql — ADR-0067 Phase B. Per-(client × product × verification_unit)
-- declaration of which rate_types are available. Additive, idempotent, re-run-safe.
-- NO FK conversion / resolution change here (that is Phase C, mig 0094).

BEGIN;

CREATE TABLE IF NOT EXISTS rate_type_assignments (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id            integer     NOT NULL REFERENCES clients (id),
  product_id           integer     NOT NULL REFERENCES products (id),
  verification_unit_id integer     NOT NULL REFERENCES verification_units (id),
  rate_type_id         integer     NOT NULL REFERENCES rate_types (id),
  is_active            boolean     NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per (combo, rate_type); bulk-set toggles is_active. Guarded so the re-run does not error.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_rate_type_assignment') THEN
    ALTER TABLE rate_type_assignments
      ADD CONSTRAINT uq_rate_type_assignment
      UNIQUE (client_id, product_id, verification_unit_id, rate_type_id);
  END IF;
END $$;

-- Availability lookup: active assignments for a combo.
CREATE INDEX IF NOT EXISTS idx_rta_combo
  ON rate_type_assignments (client_id, product_id, verification_unit_id)
  WHERE is_active;

COMMIT;
```

- [ ] **Step 4: Run the re-run guard → PASS.**
- [ ] **Step 5: Commit** — `feat(db): mig 0093 rate_type_assignments (per-combo availability) — ADR-0067`

---

## Task 3: `authorizeAny` — any-of RBAC guard (shared package, CTO inline)

**Files:** Modify `packages/access/src/<file that exports authorize>` + `index.ts`; add/extend a unit test.

- [ ] **Step 1: Read `authorize`** to copy its exact signature/middleware shape (req.auth permissions + `grantsAll`).
- [ ] **Step 2: Failing test** — `authorizeAny('a','b')` allows a user with only `b` and a `grantsAll` user; 403s a user with neither.
- [ ] **Step 3: Implement** `authorizeAny(...perms: string[])` mirroring `authorize` but passing when **any** listed perm is present (or `grantsAll`). Export from the package index next to `authorize`.
- [ ] **Step 4: `pnpm --filter @crm2/access test && pnpm --filter @crm2/access typecheck` → PASS.**
- [ ] **Step 5: Commit** — `feat(access): authorizeAny any-of permission guard — ADR-0067`

---

## Task 4: SDK contract — `RateTypeAssignment` + bulk-set schema

**Files:** Create `packages/sdk/src/rateTypeAssignments.ts`; Modify `packages/sdk/src/index.ts`; Create `packages/sdk/src/__tests__/rateTypeAssignments.test.ts`.

- [ ] **Step 1: Failing schema test** — `BulkSetRateTypeAssignmentsSchema` parses `{clientId, productId, verificationUnitId, rateTypeIds:[1,2]}`, coerces/validates positive ints, accepts an empty `rateTypeIds` array (clearing a combo), rejects a zero/negative id.
- [ ] **Step 2: Implement** `packages/sdk/src/rateTypeAssignments.ts`:

```ts
import { z } from 'zod';

/** A single (client × product × verification_unit → rate_type) availability row. */
export interface RateTypeAssignment {
  id: number;
  clientId: number;
  productId: number;
  verificationUnitId: number;
  rateTypeId: number;
  rateTypeCode: string; // joined from rate_types for display
  rateTypeName: string; // joined from rate_types for display
  isActive: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const posInt = z.number().int().positive();

/** Replace the ACTIVE assigned set for a combo (empty array clears it). */
export const BulkSetRateTypeAssignmentsSchema = z.object({
  clientId: posInt,
  productId: posInt,
  verificationUnitId: posInt,
  rateTypeIds: z.array(posInt),
});

export type BulkSetRateTypeAssignmentsInput = z.infer<typeof BulkSetRateTypeAssignmentsSchema>;
```

- [ ] **Step 3:** add `export * from './rateTypeAssignments.js';` to `packages/sdk/src/index.ts` (mirror the `rateTypes` export).
- [ ] **Step 4: `pnpm --filter @crm2/sdk test -- rateTypeAssignments && pnpm --filter @crm2/sdk typecheck` → PASS.**
- [ ] **Step 5: Commit** — `feat(sdk): RateTypeAssignment type + BulkSet schema — ADR-0067`

---

## Task 5: API — `available` resolver on the rateTypes module (CTO inline; touches a Phase-A module)

**Files:** Modify `apps/api/src/modules/rateTypes/{repository,service,controller,routes}.ts` + its integration test.

- [ ] **Step 1: Repository** — add `available(clientId, productId, unitId): Promise<RateTypeOption[]>`:

```ts
  available(clientId: number, productId: number, unitId: number): Promise<RateTypeOption[]> {
    return query<RateTypeOption>(
      `SELECT rt.id, rt.code, rt.category
         FROM rate_type_assignments a
         JOIN rate_types rt ON rt.id = a.rate_type_id
        WHERE a.client_id = $1 AND a.product_id = $2 AND a.verification_unit_id = $3
          AND a.is_active AND rt.is_active AND rt.effective_from <= now()
        ORDER BY rt.sort_order, rt.code`,
      [clientId, productId, unitId],
    );
  },
```

- [ ] **Step 2: Service** — `available(q)` parses `clientId`/`productId`/`verificationUnitId` (positive ints; 400 `BAD_REQUEST` on a missing/invalid param) and calls `repo.available(...)`.
- [ ] **Step 3: Controller** — `available(req,res,next)` → `res.json(await svc.available(req.query))`.
- [ ] **Step 4: Routes** — insert `available` **before** `/:id` (else `available` is captured as an id), any-of guard:

```ts
import { authorize, authorizeAny, PERMISSIONS } from '@crm2/access';
// ... after the /options line, before /:id:
rateTypeRoutes.get('/available',
  authorizeAny(PERMISSIONS.MASTERDATA_VIEW, PERMISSIONS.CASE_CREATE), c.available);
```

- [ ] **Step 5: Integration cases** (append to `rateTypes.integration.test.ts`): an assignment made (via direct SQL insert or the assignments API) is returned by `GET /api/v2/rate-types/available?clientId=..&productId=..&verificationUnitId=..`; a combo with no assignment returns `[]`; a `CASE_CREATE`-only role is allowed (200, not 403); a role with neither perm is 403; a missing query param → 400.
- [ ] **Step 6:** `pnpm --filter @crm2/api test -- rateTypes.integration` → PASS. (Commit with Task 6 after OpenAPI regen.)

---

## Task 6: API — `rateTypeAssignments` module (list-for-combo + bulk-set)

**Files:** Create `apps/api/src/modules/rateTypeAssignments/{repository,service,controller,routes}.ts` + `__tests__/rateTypeAssignments.integration.test.ts`; Modify `apps/api/src/http/app.ts`; Regenerate `openapi.json`.

- [ ] **Step 1: Repository** `rateTypeAssignmentRepository`:
  - `listForCombo(clientId, productId, unitId): Promise<RateTypeAssignment[]>` — active rows for the combo, `JOIN rate_types rt` for `rateTypeCode`/`rateTypeName`, `ORDER BY rt.sort_order, rt.code`.
  - `bulkSet(clientId, productId, unitId, rateTypeIds: number[], userId): Promise<RateTypeAssignment[]>` — in `withTransaction`:
    1. For each id in `rateTypeIds`: `INSERT INTO rate_type_assignments (client_id, product_id, verification_unit_id, rate_type_id, created_by, updated_by) VALUES (...) ON CONFLICT (client_id, product_id, verification_unit_id, rate_type_id) DO UPDATE SET is_active = true, updated_by = $5, updated_at = now()`.
    2. Deactivate the complement: `UPDATE rate_type_assignments SET is_active = false, updated_by = $4, updated_at = now() WHERE client_id=$1 AND product_id=$2 AND verification_unit_id=$3 AND is_active AND NOT (rate_type_id = ANY($5::int[]))` (when `rateTypeIds` is empty, deactivate all active rows for the combo).
    3. `appendAudit({ entityType: 'rate_type_assignments', entityId: unitId, action: 'BULK_SET', actorId: userId, after: { clientId, productId, verificationUnitId: unitId, rateTypeIds } }, q)` — verify the `appendAudit` signature first; record the combo + resulting set in `after`.
    4. Return `listForCombo(...)` (the new active set).
  - Map FK violation `23503` → `AppError.badRequest('INVALID_ASSIGNMENT_REF', ...)` (a bad client/product/unit/rate_type id).
- [ ] **Step 2: Service** — `listForCombo(q)` validates the three combo params (positive ints, all required → 400); `bulkSet(body, userId)` validates with `BulkSetRateTypeAssignmentsSchema`, calls `repo.bulkSet(...)`.
- [ ] **Step 3: Controller** — `listForCombo`, `bulkSet`.
- [ ] **Step 4: Routes** `rateTypeAssignmentRoutes`:

```ts
rateTypeAssignmentRoutes.get('/',     authorize(PERMISSIONS.MASTERDATA_VIEW),   c.listForCombo);
rateTypeAssignmentRoutes.post('/bulk', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.bulkSet);
```

- [ ] **Step 5: Mount** in `apps/api/src/http/app.ts` — `import { rateTypeAssignmentRoutes } from '../modules/rateTypeAssignments/routes.js';` + `mount('/api/v2/rate-type-assignments', rateTypeAssignmentRoutes);` (near the `rate-types` mount).
- [ ] **Step 6: Integration test** (mirror `rateTypes.integration.test.ts` harness): bulk-set `[LOCAL, OGL]` for HDFC/HL/<unit> → returns 2 active; `GET /?clientId..` returns the same 2; bulk-set `[OGL]` → LOCAL row goes inactive (returns 1, and `available` drops LOCAL); bulk-set `[]` → clears (returns 0); a non-existent `rateTypeId` → 400; `FIELD_AGENT` POST → 403; missing combo param on GET → 400. Resolve client/product/unit ids from the seeded catalog (query `clients`/`products`/`verification_units` by code, like the existing tests).
- [ ] **Step 7:** `pnpm --filter @crm2/api test -- rateTypeAssignments.integration` → PASS, then `pnpm --filter @crm2/api openapi && pnpm --filter @crm2/api test -- contract` (new paths present; contract green).
- [ ] **Step 8: Commit** — `feat(api): rate-type assignments (list-for-combo + bulk-set) + rate-types/available — ADR-0067` (Tasks 5 + 6 together, after openapi regen).

---

## Task 7: Web — Rate Type Assignments matrix page

**Files:** Create `apps/web/src/features/rateTypeAssignments/RateTypeAssignmentsPage.tsx`; Modify `apps/web/src/App.tsx`, `apps/web/src/components/Layout.tsx`.

- [ ] **Step 1: Create `RateTypeAssignmentsPage.tsx`.** Bespoke matrix (not the inline-grid). Behaviour:
  - RBAC self-guard at top: `const { has } = useAuth(); if (!has('page.masterdata')) return <Navigate to="/" replace />;`.
  - Three independent selects via `api()` against the `/options` endpoints: clients `GET /api/v2/clients/options`, products `GET /api/v2/products/options`, verification units `GET /api/v2/verification-units/options`. (Independent — no CPV cascade; assigning to a non-CPV combo is harmless. Note this deliberate simplification.)
  - The checkbox list = all active rate types via the SDK `client.rateTypes.list()` (= `/rate-types/options?active=true`) → `RateTypeOption[]`.
  - When all three combo selects are chosen, load the current set via `api<RateTypeAssignment[]>('GET', `/api/v2/rate-type-assignments?clientId=${c}&productId=${p}&verificationUnitId=${u}`)` and pre-check those `rateTypeId`s.
  - **Save** → `api<RateTypeAssignment[]>('POST', '/api/v2/rate-type-assignments/bulk', { clientId, productId, verificationUnitId, rateTypeIds })` via a TanStack `useMutation`; on success invalidate the combo query + show a saved confirmation. Disable Save until a combo is fully chosen. Use the shared `<Button>` (primary Save), labelled checkboxes, and tokens only (no raw colors).
  - Loading/empty/error states for each query (Hexagon loader + error/Retry, per the design standard).
- [ ] **Step 2: Route** in `App.tsx` — `<Route path="/admin/rate-type-assignments" element={<RateTypeAssignmentsPage />} />`.
- [ ] **Step 3: Nav** in `Layout.tsx` ADMINISTRATION, right after the "Rate Types" entry — `{ label: 'Rate Type Assignments', to: '/admin/rate-type-assignments', perm: 'page.masterdata' }`.
- [ ] **Step 4:** `pnpm --filter @crm2/web typecheck && pnpm --filter @crm2/web test && pnpm --filter @crm2/web build` → PASS.
- [ ] **Step 5: Commit** — `feat(web): Rate Type Assignments matrix page + nav/route — ADR-0067`

---

## Task 8: e2e + browser-verify + full gate

**Files:** Create `apps/web/e2e/rateTypeAssignments.spec.ts`.

- [ ] **Step 1: e2e spec** (Laptop-only): goto `/admin/rate-type-assignments`; pick a client/product/unit present in the e2e seed (HDFC / HL / a migration-seeded unit); check a rate type (e.g. LOCAL); Save; reload the combo; assert that rate type is still checked. (Creates its own assignment — no `e2e.seed.sql` change needed; CI dropdowns are populated by `e2e.seed.sql` clients/products + migration-seeded units/rate-types.)
- [ ] **Step 2: Run the spec against the worktree web** — per the verify-infra (kill stray listeners on 4000-4003/5290-5293; `cp` the main-tree `apps/api/.env` into the worktree; `PORT=4001 pnpm --filter @crm2/api dev`; `API_URL=http://localhost:4001 pnpm --filter @crm2/web exec vite --port 5290 --strictPort`; `pnpm exec playwright test e2e/auth.setup.ts --project=setup`; **apply mig 0093 to `crm2_dev` manually** first). `cd apps/web && E2E_BASE_URL=http://localhost:5290 pnpm exec playwright test rateTypeAssignments --project=Laptop --project=setup` → PASS.
- [ ] **Step 3: Browser-verify the real action + confirm persistence.** In the worktree web (:5290), log in admin/admin123, `/admin/rate-type-assignments`: pick HDFC → HL → a unit → check LOCAL+OGL → Save; reload → both still checked; uncheck OGL → Save → reload → only LOCAL. Confirm in `crm2_dev`:

```bash
docker exec crm2_dev_pg psql -U postgres -d crm2_dev -c \
  "SELECT a.is_active, rt.code FROM rate_type_assignments a JOIN rate_types rt ON rt.id=a.rate_type_id
     JOIN clients cl ON cl.id=a.client_id JOIN products p ON p.id=a.product_id
   WHERE cl.code='HDFC' AND p.code='HL' ORDER BY rt.code;"
```
Clean up the throwaway rows afterward (`DELETE FROM rate_type_assignments WHERE ...`). Screenshot as proof.

- [ ] **Step 4: Full gate** — `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/crm2_test LC_ALL=C pnpm verify` (do NOT pipe to `tail`), then `cd apps/web && pnpm exec playwright test` (full e2e). All green.
- [ ] **Step 5: Commit** — `test(e2e): rate-type assignments matrix assign-persist — ADR-0067`
- [ ] **Step 6: Update memory + registry; STOP for owner push approval.** Update `project_rate_type_management_2026_06_25.md` (Phase B DONE) + `MEMORY.md` index + `CRM2_MASTER_MEMORY.md §8`; disposition any follow-ups in `docs/COMPLIANCE_GAPS_REGISTRY.md §H`. **Do NOT push without explicit OK** (push → main auto-deploys: gate → GHCR → blue-green + mig 0093 to prod).

---

## Build order / parallelization (BUILD_METHOD)

- **Foundation (CTO inline, serial, gate each):** Task 1 (ADR) → Task 2 (mig + re-run test) → Task 3 (`authorizeAny`, shared pkg) → Task 4 (SDK). These are shared/foundational; everything downstream imports them.
- **Fan out (parallel, disjoint files):** Task 5 + 6 (backend agent — api modules + mount + integration tests + openapi) ∥ Task 7 (web agent — page + route + nav). `app.ts` is touched only by the backend agent; `App.tsx`/`Layout.tsx` only by the web agent → no shared-file races within this worktree.
- **CTO integrates:** Task 8 (e2e, browser-verify, full `pnpm verify`, full Playwright e2e). Then memory/registry, STOP for push.

## Self-Review
- **Spec coverage (Phase B subset):** table §3.2 ✓ (T2), bulk-set API + `available` §4 ✓ (T5/T6), matrix page §5 ✓ (T7), RBAC view/manage + any-of for `available` ✓ (T3/T5/T6), OpenAPI additive ✓ (T6), re-run safety ✓ (T2), e2e + browser-verify ✓ (T8), ADR ✓ (T1). FK conversion + picker wiring explicitly deferred to Phase C.
- **No OCC on assignments** is deliberate (bulk-set is an atomic replace) — documented in ADR-0067 + this plan.
- **Mobile:** untouched in Phase B (no `case_tasks`/sync change).
- **Resolution:** unchanged — assignments only bound availability (consumed in Phase C).
