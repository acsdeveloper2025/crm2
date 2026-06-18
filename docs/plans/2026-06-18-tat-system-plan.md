# TAT System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended)
> or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.
> Build in a fresh git worktree (superpowers:using-git-worktrees). **Never push/merge/deploy without
> explicit owner OK** (push→main auto-deploys to prod). Commits: author `Mayur Kulkarni
> <mayurkulkarni786@gmail.com>`, conventional, **NO AI/Co-Authored-By trailer**, never `--no-verify`,
> commit only at green gates.

**Goal:** give every task a configurable **target TAT** (SLA: due-date + overdue) and a measured
**completed-in band** (elapsed assign→complete, server clock), surfaced on the pipeline + case detail +
a completion report, without breaking the installed mobile app. (ADR-0044; precursor to ADR-0046.)

**Architecture:** new `tat_policies` master table (effective-dated + OCC + audited, like
`commission_rates` + `verification_units`); additive `case_tasks.tat_hours` + `completed_elapsed_minutes`;
`due_at`/`overdue`/completed-in-band are **derived** in the tasks/cases read-models; web reuses the
DataGrid/Management-List + ad-hoc tab patterns. Build order: **DB → API → SDK → Web → Mobile-contract.**

**Tech Stack:** Node 24, Express, raw SQL (no ORM), Postgres 18, Zod, `@crm2/sdk`, React +
react-query + Tailwind, Vitest (api/sdk) + Playwright (web e2e). Integration tests need
`DATABASE_URL=postgresql://postgres@127.0.0.1:5433/crm2_test LC_ALL=C`.

**Verification gate per task:** the task's tests pass, then before moving on run `pnpm verify`
(typecheck → lint → format → no-suppressions → boundaries → test → build) — green before commit.

---

## File Structure

**Create:**
- `db/v2/migrations/0077_tat_policies.sql` — `tat_policies` master + seed 4/6/8/12/24/48.
- `db/v2/migrations/0078_case_tasks_tat.sql` — `case_tasks.tat_hours` + `completed_elapsed_minutes` + backfill.
- `apps/api/src/modules/tatPolicies/{routes,controller,service,repository}.ts` + `__tests__/tatPolicies.api.test.ts`.
- `packages/sdk/src/tatPolicies.ts` — `TatPolicy`, `TatPolicyView`, `Create/ReviseTatPolicySchema`.
- `apps/api/src/platform/tat/band.ts` — the pure band classifier (shared, unit-tested) + `__tests__/band.test.ts`.
- `apps/web/src/features/tatPolicies/TatPoliciesPage.tsx` — admin CRUD page.
- `apps/web/src/features/tat/CompletionReportPage.tsx` — the assign/complete/band report.
- `apps/web/e2e/tat.spec.ts` — pipeline TAT tab + case tabs + admin CRUD e2e.

**Modify:**
- `apps/api/src/http/app.ts:34,107` — import + mount `tat-policies` routes.
- `apps/api/src/modules/tasks/repository.ts:13-19,71-78,84-136` — `due_at`/`overdue` cols + `tat` filter/sort.
- `apps/api/src/modules/tasks/service.ts:22-50,100,126,143` — `tat` param + sort/filter whitelist.
- `apps/api/src/modules/cases/repository.ts:151,703-741` (+ line ~1093) — task-view TAT cols + set `completed_elapsed_minutes` on completion.
- `apps/api/src/modules/cases/` task-create + completion-report read-model (new query).
- `packages/sdk/src/{index.ts:9,client.ts:321-335,tasks.ts:11-47,cases.ts:177-217,353}` — exports, client methods, view fields, create schema.
- `apps/web/src/App.tsx:33,69` + `components/Layout.tsx:52` — route + nav.
- `apps/web/src/features/pipeline/PipelinePage.tsx:44-53,68-83,156-163,270-274` — TAT bucket + badge hours.
- `apps/web/src/features/cases/CaseDetailPage.tsx:278-682` — task tabs.
- `apps/web/src/features/cases/AddTasksForm.tsx:39,274-286,94-103` + `cases.ts` create schema — TAT picker.

---

## Task 1: `tat_policies` migration + seed

**Files:**
- Create: `db/v2/migrations/0077_tat_policies.sql`
- Test: `apps/api/src/modules/tatPolicies/__tests__/tatPolicies.api.test.ts` (migration-applies assertion comes via the API tests in Task 3; here we validate the SQL by applying it to the test DB)

- [ ] **Step 1: Write the migration**

```sql
-- 0077_tat_policies.sql — TAT band master (ADR-0044). Effective-dated + OCC, masterdata.manage-gated.
-- The configurable set of turnaround-time bands (4/6/8/12/24/48h) used for target-TAT assignment AND
-- completed-in-band classification. Forward-only, idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS tat_policies (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tat_hours      integer     NOT NULL CHECK (tat_hours > 0),
  label          varchar(40) NOT NULL,
  is_active      boolean     NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  version        integer     NOT NULL DEFAULT 1,
  created_by     uuid,
  updated_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- one active row per band value (effective-dated revisions end-date the old row)
CREATE UNIQUE INDEX IF NOT EXISTS uq_tat_policies_hours_active
  ON tat_policies (tat_hours) WHERE is_active;

-- seed the owner-confirmed band set (idempotent: skip if a band already present)
INSERT INTO tat_policies (tat_hours, label)
SELECT v.h, v.h || ' hours'
FROM (VALUES (4),(6),(8),(12),(24),(48)) AS v(h)
WHERE NOT EXISTS (SELECT 1 FROM tat_policies t WHERE t.tat_hours = v.h);

COMMIT;
```

- [ ] **Step 2: Apply to the test DB and verify**

Run:
```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/crm2_test LC_ALL=C \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/v2/migrations/0077_tat_policies.sql
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/crm2_test LC_ALL=C \
  psql "$DATABASE_URL" -c "SELECT tat_hours, label FROM tat_policies ORDER BY tat_hours;"
```
Expected: 6 rows — `4,6,8,12,24,48` with labels `4 hours … 48 hours`. Re-running the `-f` is a no-op.

> Note: the vitest harness (`packages/test-utils/src/helpers/testDb.ts`) auto-applies every
> `db/v2/migrations/*.sql` to its template DB, so Task 3's tests pick this up automatically. Also
> `psql -f` it into the dev API DB `:54329/crm2_dev` before browser-verifying.

- [ ] **Step 3: Commit**

```bash
git add db/v2/migrations/0077_tat_policies.sql
git commit -m "feat(db): tat_policies master table + 4/6/8/12/24/48h seed (ADR-0044)"
```

---

## Task 2: band classifier (pure function + unit tests)

**Files:**
- Create: `apps/api/src/platform/tat/band.ts`
- Test: `apps/api/src/platform/tat/__tests__/band.test.ts`

- [ ] **Step 1: Write the failing test** (`band.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { classifyBand } from '../band.js';

const BANDS = [4, 6, 8, 12, 24, 48]; // usable tat_hours, ascending

describe('classifyBand', () => {
  it('returns the smallest band >= elapsed hours', () => {
    expect(classifyBand(0, BANDS)).toBe(4);          // 0 < e <= 4 -> 4
    expect(classifyBand(4 * 60, BANDS)).toBe(4);      // exactly 4h -> 4
    expect(classifyBand(4 * 60 + 1, BANDS)).toBe(6);  // 4h01m -> 6
    expect(classifyBand(7 * 60, BANDS)).toBe(8);
    expect(classifyBand(24 * 60, BANDS)).toBe(24);
  });
  it('returns -1 (overflow) when elapsed exceeds the max band', () => {
    expect(classifyBand(48 * 60 + 1, BANDS)).toBe(-1);
  });
  it('returns null when elapsed is null/undefined', () => {
    expect(classifyBand(null, BANDS)).toBeNull();
  });
  it('returns -1 when there are no usable bands', () => {
    expect(classifyBand(60, [])).toBe(-1);
  });
});
```

- [ ] **Step 2: Run it — expect FAIL** (`classifyBand` undefined)

Run: `pnpm --filter @crm2/api exec vitest run src/platform/tat/__tests__/band.test.ts`
Expected: FAIL — cannot find `../band.js`.

- [ ] **Step 3: Implement** (`band.ts`)

```ts
/** Classify an elapsed duration (minutes) into the smallest usable TAT band (hours).
 *  Returns the band's tat_hours, -1 for overflow (> max band), or null if elapsed is null.
 *  `bands` must be ascending usable tat_hours (from tat_policies). */
export function classifyBand(elapsedMinutes: number | null, bands: number[]): number | null {
  if (elapsedMinutes === null || elapsedMinutes === undefined) return null;
  const elapsedHours = elapsedMinutes / 60;
  for (const b of bands) {
    if (elapsedHours <= b) return b;
  }
  return -1;
}
```

- [ ] **Step 4: Run it — expect PASS**

Run: `pnpm --filter @crm2/api exec vitest run src/platform/tat/__tests__/band.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/platform/tat/band.ts apps/api/src/platform/tat/__tests__/band.test.ts
git commit -m "feat(api): TAT completed-in band classifier (smallest band >= elapsed, -1 overflow)"
```

---

## Task 3: `tatPolicies` API module + SDK

**Files:**
- Create: `packages/sdk/src/tatPolicies.ts`; `apps/api/src/modules/tatPolicies/{repository,service,controller,routes}.ts`; `apps/api/src/modules/tatPolicies/__tests__/tatPolicies.api.test.ts`
- Modify: `packages/sdk/src/index.ts:9`; `packages/sdk/src/client.ts:35,321`; `apps/api/src/http/app.ts:34,107`

- [ ] **Step 1: SDK contract** (`packages/sdk/src/tatPolicies.ts`)

```ts
import { z } from 'zod';

export interface TatPolicy {
  id: number;
  tatHours: number;
  label: string;
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}
export type TatPolicyView = TatPolicy;

export const CreateTatPolicySchema = z.object({
  tatHours: z.number().int().positive(),
  label: z.string().min(1).max(40),
  effectiveFrom: z.string().optional(),
});
export const ReviseTatPolicySchema = z.object({
  label: z.string().min(1).max(40),
  effectiveFrom: z.string().optional(),
});
export type CreateTatPolicyInput = z.input<typeof CreateTatPolicySchema>;
export type ReviseTatPolicyInput = z.input<typeof ReviseTatPolicySchema>;
```

Add to `packages/sdk/src/index.ts` (alongside line 9): `export * from './tatPolicies.js';`

- [ ] **Step 2: SDK client methods** (`packages/sdk/src/client.ts`)

Add import near line 35:
```ts
import { TatPolicy, TatPolicyView, CreateTatPolicyInput, ReviseTatPolicyInput } from './tatPolicies.js';
```
Add a block in the returned object near line 321 (mirror `commissionRates`):
```ts
tatPolicies: {
  list: (q: PageQuery = {}) => {
    const qs = pageQueryToParams(q).toString();
    return req<Paginated<TatPolicyView>>('GET', `/api/v2/tat-policies${qs ? `?${qs}` : ''}`);
  },
  create: (input: CreateTatPolicyInput) => req<TatPolicy>('POST', '/api/v2/tat-policies', input),
  revise: (id: number, input: ReviseTatPolicyInput & { version: number }) =>
    req<TatPolicy>('POST', `/api/v2/tat-policies/${id}/revise`, input),
  activate:   (id: number, version: number) => req<TatPolicy>('POST', `/api/v2/tat-policies/${id}/activate`,   { version }),
  deactivate: (id: number, version: number) => req<TatPolicy>('POST', `/api/v2/tat-policies/${id}/deactivate`, { version }),
},
```

- [ ] **Step 3: Write the failing API test** (`tatPolicies.api.test.ts`) — mirror `commissionRates.api.test.ts:1-37`

```ts
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const FA = authHeaderForRole('FIELD_AGENT');

describe.skipIf(!RUN)('tat-policies API (ADR-0044)', () => {
  beforeAll(async () => { await db!.migrate(); setPool(db!.pool); });
  afterAll(async () => { await db!.end(); });
  beforeEach(async () => { await db!.truncate('tat_policies'); });

  it('lists the seeded bands', async () => {
    // seed survives truncate? No — truncate clears it; re-insert one for the test:
    const created = await request(app).post('/api/v2/tat-policies').set(SA)
      .send({ tatHours: 4, label: '4 hours' });
    expect(created.status).toBe(201);
    expect(created.body.version).toBe(1);
    const list = await request(app).get('/api/v2/tat-policies').set(SA);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].tatHours).toBe(4);
  });

  it('revise bumps version (OCC) and rejects stale', async () => {
    const c = await request(app).post('/api/v2/tat-policies').set(SA).send({ tatHours: 6, label: '6 hours' });
    const ok = await request(app).post(`/api/v2/tat-policies/${c.body.id}/revise`).set(SA)
      .send({ label: '6 hrs', version: 1 });
    expect(ok.status).toBe(200);
    const stale = await request(app).post(`/api/v2/tat-policies/${c.body.id}/revise`).set(SA)
      .send({ label: 'x', version: 1 });
    expect(stale.status).toBe(409);
  });

  it('denies non-masterdata roles', async () => {
    expect((await request(app).get('/api/v2/tat-policies').set(FA)).status).toBe(403);
  });
});
```

- [ ] **Step 4: Run it — expect FAIL** (routes not mounted)

Run: `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/crm2_test LC_ALL=C pnpm --filter @crm2/api exec vitest run src/modules/tatPolicies`
Expected: FAIL — 404s (module absent).

- [ ] **Step 5: Implement the repository** (`apps/api/src/modules/tatPolicies/repository.ts`) — mirror `commissionRates/repository.ts` + `verificationUnits` appendAudit. Key methods: `list(opts)`, `create(input, userId)`, `revise(id, input, version, userId)`, `activate/deactivate(id, version, userId)`, `listUsableHours(): Promise<number[]>` (ascending usable `tat_hours` for the classifier).

```ts
import { query, withTransaction } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';
import type { TatPolicy } from '@crm2/sdk';

const COLS = `id, tat_hours AS "tatHours", label, is_active AS "isActive",
  effective_from AS "effectiveFrom", effective_to AS "effectiveTo", version,
  created_at AS "createdAt", updated_at AS "updatedAt"`;

export async function list(opts: { history?: boolean }): Promise<TatPolicy[]> {
  const where = opts.history ? '' : 'WHERE (effective_to IS NULL OR effective_to > now())';
  const { rows } = await query<TatPolicy>(`SELECT ${COLS} FROM tat_policies ${where} ORDER BY tat_hours`);
  return rows;
}

export async function listUsableHours(): Promise<number[]> {
  const { rows } = await query<{ tatHours: number }>(
    `SELECT tat_hours AS "tatHours" FROM tat_policies
     WHERE is_active AND effective_from <= now() ORDER BY tat_hours`);
  return rows.map((r) => r.tatHours);
}

export async function create(input: { tatHours: number; label: string; effectiveFrom?: string }, userId: string): Promise<TatPolicy> {
  return withTransaction(async (q) => {
    const { rows } = await q<TatPolicy>(
      `INSERT INTO tat_policies (tat_hours, label, effective_from, created_by, updated_by)
       VALUES ($1, $2, COALESCE($3::timestamptz, now()), $4, $4) RETURNING ${COLS}`,
      [input.tatHours, input.label, input.effectiveFrom ?? null, userId]);
    const row = rows[0]!;
    await appendAudit({ entityType: 'tat_policies', entityId: row.id, action: 'CREATE', actorId: userId, after: row, versionAfter: row.version }, q);
    return row;
  });
}

export async function revise(id: number, input: { label: string; effectiveFrom?: string }, version: number, userId: string): Promise<TatPolicy> {
  return withTransaction(async (q) => {
    const before = (await q<TatPolicy>(`SELECT ${COLS} FROM tat_policies WHERE id = $1`, [id])).rows[0];
    if (!before) throw AppError.notFound('TAT_POLICY_NOT_FOUND');
    const { rows } = await q<TatPolicy>(
      `UPDATE tat_policies SET label = $2, effective_from = COALESCE($3::timestamptz, effective_from),
         version = version + 1, updated_by = $4, updated_at = now()
       WHERE id = $1 AND version = $5 RETURNING ${COLS}`,
      [id, input.label, input.effectiveFrom ?? null, userId, version]);
    if (!rows[0]) throw AppError.stale(before);
    await appendAudit({ entityType: 'tat_policies', entityId: id, action: 'UPDATE', actorId: userId, before, after: rows[0], versionAfter: rows[0].version }, q);
    return rows[0];
  });
}

async function setActive(id: number, active: boolean, version: number, userId: string): Promise<TatPolicy> {
  return withTransaction(async (q) => {
    const before = (await q<TatPolicy>(`SELECT ${COLS} FROM tat_policies WHERE id = $1`, [id])).rows[0];
    if (!before) throw AppError.notFound('TAT_POLICY_NOT_FOUND');
    const { rows } = await q<TatPolicy>(
      `UPDATE tat_policies SET is_active = $2, version = version + 1, updated_by = $3, updated_at = now()
       WHERE id = $1 AND version = $4 RETURNING ${COLS}`,
      [id, active, userId, version]);
    if (!rows[0]) throw AppError.stale(before);
    await appendAudit({ entityType: 'tat_policies', entityId: id, action: active ? 'ACTIVATE' : 'DEACTIVATE', actorId: userId, before, after: rows[0], versionAfter: rows[0].version }, q);
    return rows[0];
  });
}
export const activate = (id: number, version: number, userId: string) => setActive(id, true, version, userId);
export const deactivate = (id: number, version: number, userId: string) => setActive(id, false, version, userId);
```
> Verify `AppError.notFound`/`AppError.stale` signatures against `apps/api/src/platform/errors.js` before use; mirror exactly what `commissionRates/repository.ts` calls.

- [ ] **Step 6: Implement service + controller + routes** (mirror `commissionRates/{service,controller,routes}.ts`)

`service.ts` — validate with the SDK schemas, call `requireVersion` for revise/activate/deactivate:
```ts
import { CreateTatPolicySchema, ReviseTatPolicySchema } from '@crm2/sdk';
import { requireVersion } from '../../platform/occ.js';
import * as repo from './repository.js';
// list(query) -> repo.list; create(input,userId) -> repo.create(CreateTatPolicySchema.parse(input), userId);
// revise(id,input,userId) -> repo.revise(id, ReviseTatPolicySchema.parse(input), requireVersion(input), userId);
// activate/deactivate(id, version, userId) -> repo.activate/deactivate.
```
`controller.ts` — `parseId` + `userId` helpers (copy `commissionRates/controller.ts:9-14`); `create` returns `HTTP_STATUS.CREATED`.
`routes.ts`:
```ts
import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import * as c from './controller.js';
export const tatPolicyRoutes: Router = Router();
tatPolicyRoutes.get('/', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.list);
tatPolicyRoutes.post('/', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.create);
tatPolicyRoutes.post('/:id/revise', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.revise);
tatPolicyRoutes.post('/:id/activate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.activate);
tatPolicyRoutes.post('/:id/deactivate', authorize(PERMISSIONS.MASTERDATA_MANAGE), c.deactivate);
```

- [ ] **Step 7: Mount the routes** (`apps/api/src/http/app.ts`)

Add near line 34: `import { tatPolicyRoutes } from '../modules/tatPolicies/routes.js';`
Add near line 107 (in the `mount(...)` block): `mount('/api/v2/tat-policies', tatPolicyRoutes);`

- [ ] **Step 8: Run tests — expect PASS**

Run: `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/crm2_test LC_ALL=C pnpm --filter @crm2/api exec vitest run src/modules/tatPolicies`
Expected: PASS (3 tests). Then `pnpm --filter @crm2/sdk build` to confirm SDK types compile.

- [ ] **Step 9: Commit**

```bash
git add packages/sdk/src/tatPolicies.ts packages/sdk/src/index.ts packages/sdk/src/client.ts \
  apps/api/src/modules/tatPolicies apps/api/src/http/app.ts
git commit -m "feat(api): tat-policies CRUD module + SDK (effective-dated, OCC, audited, masterdata.manage)"
```

---

## Task 4: `case_tasks` TAT columns + backfill

**Files:**
- Create: `db/v2/migrations/0078_case_tasks_tat.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 0078_case_tasks_tat.sql — per-task target TAT + measured completed-in elapsed (ADR-0044).
-- tat_hours = the assigned target band; completed_elapsed_minutes = immutable elapsed assigned->completed.
-- Forward-only, idempotent. due_at/overdue/completed-in-band are DERIVED at read time (not stored).

ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS tat_hours integer;
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS completed_elapsed_minutes integer;

-- backfill target TAT from the legacy priority enum (ADR-0044 locked mapping), only where unset
UPDATE case_tasks SET tat_hours = CASE priority
    WHEN 'URGENT' THEN 4 WHEN 'HIGH' THEN 8 WHEN 'MEDIUM' THEN 24 WHEN 'LOW' THEN 48 ELSE 24 END
  WHERE tat_hours IS NULL;

-- backfill measured elapsed for already-completed tasks (assigned->completed; fall back to created)
UPDATE case_tasks
  SET completed_elapsed_minutes =
    CEIL(EXTRACT(EPOCH FROM (completed_at - COALESCE(assigned_at, created_at))) / 60)::int
  WHERE status = 'COMPLETED' AND completed_at IS NOT NULL AND completed_elapsed_minutes IS NULL;
```

- [ ] **Step 2: Apply + verify**

Run:
```bash
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/crm2_test LC_ALL=C \
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/v2/migrations/0078_case_tasks_tat.sql
DATABASE_URL=postgresql://postgres@127.0.0.1:5433/crm2_test LC_ALL=C \
  psql "$DATABASE_URL" -c "\d case_tasks" | grep -E "tat_hours|completed_elapsed_minutes"
```
Expected: both columns present (`integer`).

- [ ] **Step 3: Commit**

```bash
git add db/v2/migrations/0078_case_tasks_tat.sql
git commit -m "feat(db): case_tasks.tat_hours + completed_elapsed_minutes + priority->TAT backfill (ADR-0044)"
```

---

## Task 5: target-TAT read-model (`due_at`/`overdue`) + `tat` filter + task-create accepts `tatHours`

**Files:**
- Modify: `apps/api/src/modules/tasks/repository.ts` (SELECT + WHERE), `tasks/service.ts` (param + whitelist), `packages/sdk/src/tasks.ts` (TaskView fields), cases task-create path + `packages/sdk/src/cases.ts` create schema.
- Test: extend `apps/api/src/modules/tasks/__tests__/tasks.api.test.ts`.

- [ ] **Step 1: Write the failing test** (append to `tasks.api.test.ts`)

```ts
it('exposes due_at/overdue and filters by tat=1', async () => {
  // create a case+task assigned now with tat_hours=4 via the API fixtures used elsewhere in this file;
  // then a task whose assigned_at is far in the past so overdue=true.
  const res = await request(app).get('/api/v2/tasks?tat=1').set(SA);
  expect(res.status).toBe(200);
  // overdue tasks present, ordered overdue-first then due_at asc:
  expect(res.body.items.every((t: { overdue: boolean }) => t.overdue)).toBe(true);
  expect(res.body.items[0]).toHaveProperty('tatHours');
  expect(res.body.items[0]).toHaveProperty('dueAt');
});
```
(Use the same case/task creation helpers already present in this test file; set `assigned_at` in the past via a direct `db` update if no API path exists, mirroring how other time-based tests seed.)

- [ ] **Step 2: Run — expect FAIL** (no `tat` filter / fields)

Run: `DATABASE_URL=... LC_ALL=C pnpm --filter @crm2/api exec vitest run src/modules/tasks/__tests__/tasks.api.test.ts -t "due_at"`
Expected: FAIL.

- [ ] **Step 3: Add derived columns** (`tasks/repository.ts`, in `TASK_SELECT_BASE` near lines 71-78, next to `out_of_tat`)

```ts
ct.tat_hours AS tat_hours,
(ct.assigned_at + (ct.tat_hours * interval '1 hour')) AS due_at,
(ct.status IN ('PENDING','ASSIGNED','IN_PROGRESS')
   AND ct.tat_hours IS NOT NULL AND ct.assigned_at IS NOT NULL
   AND now() > ct.assigned_at + (ct.tat_hours * interval '1 hour')) AS overdue,
ct.completed_elapsed_minutes AS completed_elapsed_minutes,
```

- [ ] **Step 4: Add the `tat` filter + sort** — define the overdue predicate once and reuse:

In `tasks/repository.ts` near `SLA_BREACH_SQL` (line 13):
```ts
const OVERDUE_SQL = `(ct.status IN ('PENDING','ASSIGNED','IN_PROGRESS')
  AND ct.tat_hours IS NOT NULL AND ct.assigned_at IS NOT NULL
  AND now() > ct.assigned_at + (ct.tat_hours * interval '1 hour'))`;
```
In `buildWhere` (near line 128, next to the `outOfTat` push): `if (o.tat) where.push(OVERDUE_SQL);`
Add `tat?: boolean` to `TaskListOptions` (near line 40). For the TAT-tab ordering, when `o.tat` apply
`ORDER BY ${OVERDUE_SQL} DESC, due_at ASC NULLS LAST` (gate this so it does not override an explicit sort).
In `tasks/service.ts`: parse `const tat = rawQuery['tat'] === '1' || rawQuery['tat'] === 'true';` (near line 100),
thread `...(d.tat ? { tat: true } : {})` into options (near line 126), echo into response `filters` (near line 143).

- [ ] **Step 5: SDK TaskView fields** (`packages/sdk/src/tasks.ts`, next to `outOfTat` line 44)

```ts
tatHours: number | null;
dueAt: string | null;
overdue: boolean;
completedElapsedMinutes: number | null;
```

- [ ] **Step 6: task-create accepts `tatHours`** (additive)

In `packages/sdk/src/cases.ts` task-create schema (line ~353), add `tatHours: z.number().int().positive().optional()`
alongside the existing `priority`. In the cases task-insert repository path, persist `tat_hours` from the
input (default via the priority→hours map when omitted, using the same CASE expression as the migration).

- [ ] **Step 7: Run tests — expect PASS**, then `pnpm verify`

Run: `DATABASE_URL=... LC_ALL=C pnpm --filter @crm2/api exec vitest run src/modules/tasks` then `pnpm verify`
Expected: PASS; verify green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/tasks packages/sdk/src/tasks.ts packages/sdk/src/cases.ts apps/api/src/modules/cases
git commit -m "feat(api): target-TAT due_at/overdue read-model, tat filter+sort, task-create tatHours"
```

---

## Task 6: set `completed_elapsed_minutes` on completion + completed-in band in read-models

**Files:**
- Modify: `apps/api/src/modules/cases/repository.ts` (`completeTask` ~703-741, and the line ~1093 completion writer), `tasks/repository.ts` + `cases/repository.ts` (band column), `packages/sdk/src/{tasks.ts,cases.ts}` (band field).
- Test: extend `tasks.api.test.ts` (or a cases completion test).

- [ ] **Step 1: Write the failing test** — completing a task stamps elapsed + classifies a band

```ts
it('stamps completed_elapsed_minutes and a completed band on completion', async () => {
  // assign a task ~5h ago (direct db update of assigned_at), then complete it via the API path;
  const done = await request(app).get('/api/v2/tasks?status=COMPLETED').set(SA);
  const t = done.body.items[0];
  expect(t.completedElapsedMinutes).toBeGreaterThan(0);
  expect(t.completedTatBand).toBe(6); // ~5h -> 6h band
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `DATABASE_URL=... LC_ALL=C pnpm --filter @crm2/api exec vitest run -t "completed band"`
Expected: FAIL.

- [ ] **Step 3: Stamp elapsed in the completion transaction** (`cases/repository.ts` `completeTask`, add to the SET clause)

```sql
completed_at = now(),
completed_elapsed_minutes = CEIL(EXTRACT(EPOCH FROM (now() - COALESCE(assigned_at, created_at))) / 60)::int,
```
Apply the same to the other `status='COMPLETED', completed_at = now()` writer near line 1093 (confirm it is a task-completion path first). In the case-reopen path (`completed_at = NULL`, ~line 122) also null `completed_elapsed_minutes`.

- [ ] **Step 4: Add the completed-in band column** to the task read-models. Since the band depends on the
configurable bands, resolve it in SQL against `tat_policies` (so display reflects current policy; the
ADR-0046 commission slice snapshots it at finalize):

In `tasks/repository.ts` SELECT (and `cases/repository.ts` task-view SELECT ~line 151):
```sql
COALESCE((SELECT tp.tat_hours FROM tat_policies tp
  WHERE tp.is_active AND tp.effective_from <= now()
    AND tp.tat_hours >= CEIL(ct.completed_elapsed_minutes / 60.0)
  ORDER BY tp.tat_hours ASC LIMIT 1),
  CASE WHEN ct.completed_elapsed_minutes IS NULL THEN NULL ELSE -1 END) AS completed_tat_band
```

- [ ] **Step 5: SDK band field** (`tasks.ts` + `cases.ts` `CaseTaskView` near line 217)

```ts
/** tat_hours of the band the task was completed within; -1 = beyond max band; null = not completed. */
completedTatBand: number | null;
```

- [ ] **Step 6: Run tests — expect PASS**, then `pnpm verify`

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/cases apps/api/src/modules/tasks packages/sdk/src/tasks.ts packages/sdk/src/cases.ts
git commit -m "feat(api): stamp completed_elapsed_minutes on completion + derive completed-in TAT band"
```

---

## Task 7: `tat_policies` admin page + route + nav

**Files:**
- Create: `apps/web/src/features/tatPolicies/TatPoliciesPage.tsx`
- Modify: `apps/web/src/App.tsx:33,69`, `apps/web/src/components/Layout.tsx:52`
- Test: `apps/web/e2e/tat.spec.ts` (admin CRUD slice)

- [ ] **Step 1: Build the page** — mirror `CommissionRatesPage.tsx` exactly (DataGrid + Dialog + OCC),
gated `masterdata.manage`. Columns: `tatHours` (sortable), `label`, status (`isActive`), `effectiveFrom`
(`formatDateTime`), row actions (Revise / Activate / Deactivate). Create dialog fields: `tatHours`
(number), `label` (text), `effectiveFrom` (date). Use `api`/`apiExport` from `../../lib/sdk.js`,
`useQuery`/`useMutation`, `isStale` OCC mapping, `toast`. `fetchPage = (q) => api('GET',
'/api/v2/tat-policies?'+pageQueryToParams(q))` returning `Paginated<TatPolicyView>`; `queryKey:'tat-policies'`.

- [ ] **Step 2: Route + nav**

`App.tsx`: import near line 33 `import { TatPoliciesPage } from './features/tatPolicies/TatPoliciesPage.js';`
and add after line 69: `<Route path="/admin/tat-policies" element={<TatPoliciesPage />} />`.
`Layout.tsx` ADMINISTRATION array after line 52: `{ label: 'TAT Policies', to: '/admin/tat-policies', perm: 'masterdata.manage' },`.

- [ ] **Step 3: e2e** (`apps/web/e2e/tat.spec.ts`) — mirror `pipeline.spec.ts` structure; run at Laptop band:

```ts
import { test, expect } from '@playwright/test';
test.skip(({ viewport }) => viewport?.width !== 1280, 'behavior once at Laptop');
test('TAT policies admin lists bands and creates one', async ({ page }) => {
  await page.goto('/admin/tat-policies');
  await expect(page.getByText('TAT Policies')).toBeVisible();
  await expect(page.getByText('4 hours')).toBeVisible();
});
```

- [ ] **Step 4: Run + browser-verify**

Run: `pnpm --filter @crm2/web test:e2e tat.spec.ts` (after `psql -f` the migrations into `:54329/crm2_dev`).
Then **live browser-verify** (feedback_browser_verify): open `/admin/tat-policies`, create a policy, confirm it persists after reload.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/tatPolicies apps/web/src/App.tsx apps/web/src/components/Layout.tsx apps/web/e2e/tat.spec.ts
git commit -m "feat(web): TAT policies admin page (DataGrid CRUD, OCC) + route + nav"
```

---

## Task 8: per-task TAT badge with hours (Pipeline + case-detail rows)

**Files:**
- Modify: `apps/web/src/features/pipeline/PipelinePage.tsx:156-163`
- Test: `apps/web/e2e/tat.spec.ts`

- [ ] **Step 1: Enhance the badge** (PipelinePage lines 156-163). Keep the existing trigger but append hours:

```tsx
{(t.overdue || t.outOfTat) && (
  <span className="rounded bg-st-rejected-bg px-1.5 py-0.5 text-xs font-medium text-st-rejected"
        title="Out of TAT (SLA breached)">
    ⚠ TAT{t.dueAt ? ` +${Math.max(0, Math.floor((Date.now() - new Date(t.dueAt).getTime()) / 3.6e6))}h` : ''}
    {t.tatHours ? ` / ${t.tatHours}h` : ''}
  </span>
)}
```
(Shows hours-overdue first, then the target TAT — per the owner's "2nd one then 1st".)

- [ ] **Step 2: e2e assertion** — add to `tat.spec.ts`: an overdue task row shows `⚠ TAT +`.

- [ ] **Step 3: Run + browser-verify** the pipeline badge renders hours on an overdue task.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/pipeline/PipelinePage.tsx apps/web/e2e/tat.spec.ts
git commit -m "feat(web): per-task Out-of-TAT badge shows hours-overdue then target TAT"
```

---

## Task 9: Pipeline TAT tab

**Files:**
- Modify: `apps/web/src/features/pipeline/PipelinePage.tsx:44-53,68-83,270-274`
- Test: `apps/web/e2e/tat.spec.ts`

- [ ] **Step 1: Add the bucket** (BUCKETS array, near line 52, before/after "Out of TAT"):

```ts
{ label: 'TAT', tat: true, stat: 'outOfTat' },
```
(Add a `tat?: boolean` to the BUCKETS type. Reuse `outOfTat` for the count, or add a `tat` stat if the
API exposes one; counting overdue is sufficient.)

- [ ] **Step 2: URL state + filter** (selectBucket near line 73; grid filters near line 270):

In `selectBucket`: `next.delete('tat');` in the clear block, and `if (b.tat) next.set('tat', '1');`.
Read `const tat = searchParams.get('tat') === '1';`. In the grid `filters` prop add `tat: tat ? '1' : undefined`.
The server already orders overdue-first by `due_at` when `tat=1` (Task 5 Step 4).

- [ ] **Step 3: e2e** — clicking the TAT pill sets `?tat=1` and `aria-pressed`:

```ts
test('Pipeline TAT tab filters to overdue, urgency-ordered', async ({ page }) => {
  await page.goto('/pipeline');
  await page.getByRole('button', { name: 'TAT' }).click();
  await expect(page).toHaveURL(/tat=1/);
});
```

- [ ] **Step 4: Run + browser-verify** the TAT tab loads overdue tasks ordered by urgency.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/pipeline/PipelinePage.tsx apps/web/e2e/tat.spec.ts
git commit -m "feat(web): Pipeline TAT tab (overdue tasks, urgency-ordered)"
```

---

## Task 10: Case-detail task tabs (TAT / In Progress / Complete)

**Files:**
- Modify: `apps/web/src/features/cases/CaseDetailPage.tsx` (`TasksSection` ~278-682)
- Test: `apps/web/e2e/tat.spec.ts`

- [ ] **Step 1: Add a tab state + filter** inside `TasksSection`. Use the UserDialog tab markup
(`UsersPage.tsx:600-616`) — there is no shared Tabs primitive:

```tsx
const [tab, setTab] = useState<'all' | 'tat' | 'inprogress' | 'complete'>('all');
const shown = tasks.filter((t) =>
  tab === 'all' ? true
  : tab === 'inprogress' ? t.status === 'IN_PROGRESS'
  : tab === 'complete' ? t.status === 'COMPLETED'
  : /* tat */ t.overdue === true);
```
Render the tablist (copy the `role="tablist"` block from UsersPage:600-616 with these four tabs) above the
task `<table>` (line ~420), and map over `shown` instead of `tasks`.

> Requires `overdue` on `CaseTaskView` — add it to `cases.ts` `CaseTaskView` + the `cases/repository.ts`
> task-view SELECT (the `due_at`/`overdue` expressions from Task 5 Step 3) if not already surfaced there.

- [ ] **Step 2: e2e** — the case detail page shows tabs and filters tasks:

```ts
test('Case detail has TAT/In Progress/Complete task tabs', async ({ page }) => {
  await page.goto('/cases'); await page.getByRole('row').nth(1).click();
  await expect(page.getByRole('tab', { name: 'Complete' })).toBeVisible();
  await page.getByRole('tab', { name: 'Complete' }).click();
});
```

- [ ] **Step 3: Run + browser-verify** the tabs filter the case's tasks.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/features/cases/CaseDetailPage.tsx packages/sdk/src/cases.ts apps/api/src/modules/cases apps/web/e2e/tat.spec.ts
git commit -m "feat(web): case-detail task tabs (TAT / In Progress / Complete)"
```

---

## Task 11: creation TAT picker + completion report + mobile back-compat

**Files:**
- Modify: `apps/web/src/features/cases/AddTasksForm.tsx:39,274-286,94-103`
- Create: `apps/web/src/features/tat/CompletionReportPage.tsx` (+ route/nav), completion-report API read-model
- Modify: mobile sync DTO (`apps/api/src/modules/sync/`)
- Test: `tat.spec.ts`, a sync contract test

- [ ] **Step 1: TAT picker** — in `AddTasksForm.tsx` replace the priority `<select>` (lines 274-286) with a
TAT-band select sourced from `useQuery(['tat-policies'], () => api('GET','/api/v2/tat-policies'))`; change
`TaskRow`/`emptyTask` (line 39) to carry `tatHours`, and the POST body (lines 94-103) to send `tatHours`.
Keep sending `priority` (derived from the chosen band via the inverse of the ADR-0044 map) so existing
consumers stay happy.

- [ ] **Step 2: Completion report** — API read-model: `GET /api/v2/tat/completions` returning per completed
task `{ executive, caseNumber, taskId, assignedAt, completedAt, completedElapsedMinutes, completedTatBand }`,
`case.view`-gated + scope-applied (reuse `caseScopePredicate`). Web page `CompletionReportPage.tsx` =
DataGrid (mirror CommissionRatesPage), filterable by executive/date/band; route `/reports/tat-completions`
+ nav (perm `case.view`). NO amounts (that is the Billing page, ADR-0046).

- [ ] **Step 3: Mobile back-compat** — confirm the sync DTO still emits `priority`; add `tatHours`+`dueAt`
additively. Contract test asserts `priority` is still present in the sync payload (never break the app, ADR-0011).

```ts
it('sync DTO still emits priority (mobile back-compat) and adds tatHours', async () => {
  const res = await request(app).get('/api/v2/sync/...').set(FA); // the real down-sync route
  const task = res.body.tasks[0];
  expect(task).toHaveProperty('priority');   // back-compat
  expect(task).toHaveProperty('tatHours');   // additive
});
```

- [ ] **Step 4: Run all + `pnpm verify` + e2e + browser-verify** (creation picker persists; completion report renders).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/cases/AddTasksForm.tsx apps/web/src/features/tat apps/api/src/modules/sync apps/api/src/modules/cases packages/sdk apps/web/src/App.tsx apps/web/src/components/Layout.tsx apps/web/e2e/tat.spec.ts
git commit -m "feat(web,api): TAT creation picker, completion report, mobile-safe sync DTO"
```

---

## Final verification (TAT slice done)

- [ ] Fresh-DB migration replay clean (`0077`,`0078`); `priority` still populated; backfill correct.
- [ ] `classifyBand` unit matrix green (boundaries 4/6/8/12/24/48 + overflow + null).
- [ ] `pnpm verify` GREEN (coverage floors not lowered).
- [ ] `pnpm --filter @crm2/web test:e2e` GREEN at all viewports.
- [ ] Browser-verified: admin CRUD, pipeline TAT tab + badge hours, case-detail tabs, creation picker, completion report — each performed and confirmed persisted.
- [ ] Mobile `/api/v2` sync still emits `priority` (contract test green).
- [ ] Update `CRM2_MASTER_MEMORY.md §8` + Claude memory; then begin the commission slice (ADR-0046).

## Self-review notes (spec coverage)

Covers TAT design-spec §9 tasks 1–11: policies master (T1,T3,T7), classifier (T2), task columns/backfill
(T4), target-TAT read-model + filter + create (T5), completed-in band (T6), admin (T7), per-task badge
hours (T8), pipeline TAT tab (T9), case-detail tabs (T10), creation picker + completion report + mobile
(T11). **Deferred to ADR-0046 (NOT here):** commission `commission_rates` dimensions + resolver rewrite,
`bill_count` rollup fix, pipeline "Commissionable" removal, Billing & Commission redesign, snapshot at
finalize. **Verify-before-coding:** confirm `AppError.notFound/stale`, `requireVersion`, `appendAudit`
signatures and the exact line numbers above (code may have shifted) against the cited reference files.
