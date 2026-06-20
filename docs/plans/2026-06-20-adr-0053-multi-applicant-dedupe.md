# ADR-0053 — Multi-applicant batch dedupe + post-creation applicant add — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the new-case dedupe gate check *all* applicants (not just the primary), and add a path to add a co-applicant after the case exists — each late addition deduped + audited.

**Architecture:** Two parts. (A) **Batch dedupe at creation** is front-end only: the Search button calls the existing `POST /cases/dedupe` once per applicant and groups results — no API change. (B) **Post-creation add** is a new `POST /api/v2/cases/:id/applicants` endpoint (guard `CASE_CREATE`), with the dedupe verdict stored on the new `case_applicants` row (mig 0087, three additive columns). Edit/remove of applicants is out of scope.

**Tech Stack:** Node 24 · pnpm monorepo · Express + Zod + raw SQL (pg) in repositories · `@crm2/sdk` contract · React + TanStack Query + Tailwind (web) · Vitest + ephemeral Postgres on :5433.

**Source of truth:** [docs/adr/ADR-0053-multi-applicant-batch-dedupe-and-post-creation-add.md](../adr/ADR-0053-multi-applicant-batch-dedupe-and-post-creation-add.md).

**Verify command (must be green before any commit):**
`DATABASE_URL=postgresql://postgres:postgres@localhost:5433/crm2_test LC_ALL=C pnpm verify`

**Conventions:** conventional commits, author `Mayur Kulkarni <mayurkulkarni786@gmail.com>`, NO AI/Co-Authored-By trailer, never `--no-verify`. Commit at each green task. **Do not push** — the owner authorizes pushes (push→main auto-deploys to prod), and a 4-agent review gate runs first.

---

## File Structure

**Create:**
- `db/v2/migrations/0087_case_applicant_dedupe.sql` — adds `dedupe_decision`/`dedupe_rationale`/`dedupe_matched_case_numbers[]` to `case_applicants` (additive, re-run-safe).
- `apps/web/src/features/cases/dedupeBatch.ts` — pure helper: aggregate per-applicant dedupe groups → case-level decision + matched case numbers (unit-testable; Part A logic out of the component).
- `apps/web/src/features/cases/dedupeBatch.test.ts` — unit tests for the helper.

**Modify:**
- `packages/sdk/src/cases.ts` — `AddApplicantSchema` + `AddApplicantInput`; optional dedupe fields on `CaseApplicant`.
- `packages/sdk/src/cases.test.ts` — schema tests.
- `packages/sdk/src/client.ts` — `cases.addApplicant`.
- `apps/api/src/modules/cases/repository.ts` — `caseStatusOf` + `addApplicant`.
- `apps/api/src/modules/cases/service.ts` — `addApplicant` (status guard).
- `apps/api/src/modules/cases/controller.ts` — `addApplicant` handler.
- `apps/api/src/modules/cases/routes.ts` — `POST /:id/applicants`.
- `apps/api/src/modules/cases/__tests__/cases.api.test.ts` — addApplicant integration tests.
- `apps/api/openapi.json` — regen (generated).
- `apps/web/src/features/cases/CaseCreatePage.tsx` — batch dedupe across all applicants (uses the helper).
- `apps/web/src/features/cases/CaseDetailPage.tsx` — inline "Add applicant" form + dedupe sub-flow.

**Out of scope:** editing/removing applicants; a backend batch-dedupe endpoint; realtime `case:updated` on add (the detail page invalidates its own query).

---

## Task 1: Migration 0087 — dedupe columns on `case_applicants`

**Files:**
- Create: `db/v2/migrations/0087_case_applicant_dedupe.sql`
- Test: `apps/api/src/platform/__tests__/migrations.rerun.test.ts` (existing guardrail — must stay green)

- [ ] **Step 1: Write the migration**

```sql
-- 0087_case_applicant_dedupe.sql — per-applicant dedupe verdict (ADR-0053).
-- A case's original applicants are deduped atomically at creation and the decision is recorded on the
-- `cases` row. An applicant ADDED after creation (POST /cases/:id/applicants) carries its OWN dedupe
-- verdict on its row: dedupe_decision NULL => a creation-time applicant (covered by the case-level
-- record); non-NULL => added post-creation. Additive, idempotent, re-run-safe (no DROP/ADD on an
-- existing constraint, so it cannot become a migrate-rerun deploy blocker like the 0037/0083 traps).
BEGIN;

ALTER TABLE case_applicants
  ADD COLUMN IF NOT EXISTS dedupe_decision varchar(30),
  ADD COLUMN IF NOT EXISTS dedupe_rationale text,
  ADD COLUMN IF NOT EXISTS dedupe_matched_case_numbers text[] NOT NULL DEFAULT '{}';

-- CHECK added via a guarded ADD CONSTRAINT (no IF NOT EXISTS for CHECK in PG) so re-run is a no-op.
-- All pre-existing rows have dedupe_decision = NULL (new column) => they satisfy the NULL branch; the
-- constraint can never reject live data on re-validation.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_case_applicant_dedupe_decision') THEN
    ALTER TABLE case_applicants
      ADD CONSTRAINT chk_case_applicant_dedupe_decision
      CHECK (dedupe_decision IS NULL OR dedupe_decision IN ('NO_DUPLICATES_FOUND', 'CREATE_NEW'));
  END IF;
END$$;

COMMIT;
```

- [ ] **Step 2: Run the migration-rerun guardrail**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/crm2_test LC_ALL=C pnpm --filter @crm2/api test -- migrations.rerun`
Expected: PASS (the harness applies every migration 3× and asserts no throw; 0087 re-applies cleanly — `ADD COLUMN IF NOT EXISTS` + guarded constraint).

- [ ] **Step 3: Commit**

```bash
git add db/v2/migrations/0087_case_applicant_dedupe.sql
git commit -m "feat(db): 0087 per-applicant dedupe columns on case_applicants (ADR-0053)"
```

---

## Task 2: SDK — `AddApplicantSchema`, types, client method

**Files:**
- Modify: `packages/sdk/src/cases.ts` (after `CreateCaseSchema`/`CreateCaseInput`, ~line 378; and `CaseApplicant` interface ~line 126)
- Modify: `packages/sdk/src/client.ts:619-649` (cases block)
- Test: `packages/sdk/src/cases.test.ts`

- [ ] **Step 1: Write the failing schema tests**

Append to `packages/sdk/src/cases.test.ts`:

```ts
import { AddApplicantSchema } from './cases.js';

describe('AddApplicantSchema (ADR-0053)', () => {
  const base = { name: 'Sita Rao', dedupeDecision: 'NO_DUPLICATES_FOUND' as const };

  it('accepts a clean add with no rationale', () => {
    expect(AddApplicantSchema.safeParse(base).success).toBe(true);
  });

  it('accepts CREATE_NEW with a rationale', () => {
    const r = AddApplicantSchema.safeParse({
      ...base,
      dedupeDecision: 'CREATE_NEW',
      dedupeRationale: 'different loan, same person',
      dedupeMatches: ['CASE-000123'],
    });
    expect(r.success).toBe(true);
  });

  it('rejects CREATE_NEW without a rationale', () => {
    const r = AddApplicantSchema.safeParse({ ...base, dedupeDecision: 'CREATE_NEW' });
    expect(r.success).toBe(false);
  });

  it('rejects a missing name', () => {
    expect(AddApplicantSchema.safeParse({ dedupeDecision: 'NO_DUPLICATES_FOUND' }).success).toBe(false);
  });

  it('rejects a malformed PAN', () => {
    expect(AddApplicantSchema.safeParse({ ...base, pan: 'nope' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @crm2/sdk test -- cases`
Expected: FAIL — `AddApplicantSchema` is not exported.

- [ ] **Step 3: Add the schema + type** (in `packages/sdk/src/cases.ts`, immediately after `export type CreateCaseInput = ...` ~line 378)

```ts
/** Add ONE applicant (always a co-applicant) to an existing case, with its own dedupe verdict
 *  (ADR-0053). Mirrors the create-case dedupe contract for a single applicant. */
export const AddApplicantSchema = z
  .object({
    name,
    mobile: mobile.optional(),
    pan: pan.optional(),
    companyName: companyName.optional(),
    dedupeDecision: z.enum(DEDUPE_DECISIONS),
    dedupeRationale: z.string().trim().max(2000).optional(),
    dedupeMatches: z.array(z.string().trim().max(20)).max(200).optional(),
  })
  .refine((v) => v.dedupeDecision !== 'CREATE_NEW' || (v.dedupeRationale?.length ?? 0) >= MIN_RATIONALE, {
    message: 'a rationale is required when adding an applicant despite duplicates',
    path: ['dedupeRationale'],
  });
export type AddApplicantInput = z.infer<typeof AddApplicantSchema>;
```

- [ ] **Step 4: Add optional read fields to `CaseApplicant`** (in `packages/sdk/src/cases.ts`, inside `interface CaseApplicant`, after `createdAt`)

```ts
  /** ADR-0053: dedupe verdict for an applicant ADDED after creation. NULL/absent for the original
   *  set (whose dedupe is recorded on the case). */
  dedupeDecision?: DedupeDecision | null;
  dedupeRationale?: string | null;
  dedupeMatchedCaseNumbers?: string[];
```

- [ ] **Step 5: Add the client method** (in `packages/sdk/src/client.ts`, in the `cases:` block after `addTasks`, ~line 649)

```ts
      /** ADR-0053: add a co-applicant to an existing OPEN case (with its own dedupe verdict). */
      addApplicant: (id: string, input: AddApplicantInput) =>
        req<CaseApplicant>('POST', `/api/v2/cases/${id}/applicants`, input),
```

Ensure `AddApplicantInput` and `CaseApplicant` are imported at the top of `client.ts` from `./cases.js` (add to the existing import list if absent).

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @crm2/sdk test -- cases`
Expected: PASS (all 5 new cases + existing).

- [ ] **Step 7: Commit**

```bash
git add packages/sdk/src/cases.ts packages/sdk/src/cases.test.ts packages/sdk/src/client.ts
git commit -m "feat(sdk): AddApplicantSchema + cases.addApplicant (ADR-0053)"
```

---

## Task 3: API — repository `caseStatusOf` + `addApplicant`

**Files:**
- Modify: `apps/api/src/modules/cases/repository.ts` (after `clientProductOf`, ~line 373; imports at top)

- [ ] **Step 1: Ensure imports** — at the top of `repository.ts`, the `@crm2/sdk` import must include `AddApplicantInput` and `CaseApplicant` (add to the existing `import type { ... } from '@crm2/sdk'` list).

- [ ] **Step 2: Add `caseStatusOf` + `addApplicant`** (after `clientProductOf`, ~line 373)

```ts
  /** A case's current status — for open-state guards (ADR-0053 add-applicant). */
  async caseStatusOf(caseId: string): Promise<string | null> {
    const rows = await query<{ status: string }>(`SELECT status FROM cases WHERE id = $1`, [caseId]);
    return rows[0]?.status ?? null;
  },

  /** Add ONE co-applicant to an existing case (ADR-0053). Always CO_APPLICANT / non-primary; carries
   *  its own dedupe verdict. The service has already validated the case is open. */
  async addApplicant(caseId: string, input: AddApplicantInput, userId: string): Promise<CaseApplicant> {
    return await withTransaction(async (q) => {
      const [row] = await q<CaseApplicant>(
        `INSERT INTO case_applicants
           (case_id, name, mobile, pan, company_name, applicant_type, is_primary, calling_code,
            dedupe_decision, dedupe_rationale, dedupe_matched_case_numbers)
         VALUES ($1, $2, $3, $4, $5, 'CO_APPLICANT', false, $6, $7, $8, $9)
         RETURNING id, case_id, name, mobile, pan, company_name, applicant_type, is_primary,
                   calling_code, created_at, dedupe_decision, dedupe_rationale, dedupe_matched_case_numbers`,
        [
          caseId,
          input.name,
          input.mobile ?? null,
          input.pan ?? null,
          input.companyName ?? null,
          nextCallingCode(),
          input.dedupeDecision,
          input.dedupeRationale ?? null,
          input.dedupeMatches ?? [],
        ],
      );
      if (!row) throw AppError.internal('insert returned no row');
      await appendAudit(
        { entityType: 'case_applicant', entityId: row.id, action: 'CREATE', actorId: userId, after: row },
        q,
      );
      return row;
    });
  },
```

(The `platform/db` query layer camel-cases columns, so `company_name → companyName`, `dedupe_matched_case_numbers → dedupeMatchedCaseNumbers`, etc. — the `RETURNING` row matches `CaseApplicant`.)

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @crm2/api exec tsc -p tsconfig.json --noEmit`
Expected: PASS (no errors). Implementation is exercised by the integration tests in Task 5.

---

## Task 4: API — service + controller + route

**Files:**
- Modify: `apps/api/src/modules/cases/service.ts` (after `create`, ~line 175; import `AddApplicantSchema` + `CaseApplicant` type)
- Modify: `apps/api/src/modules/cases/controller.ts` (add handler after `create`/`addTasks`)
- Modify: `apps/api/src/modules/cases/routes.ts` (add route near `/:id/tasks`)

- [ ] **Step 1: Add the service method** (in `service.ts`, after `create`, ~line 175). Ensure `AddApplicantSchema` is imported from `@crm2/sdk` and the `CaseApplicant` type too.

```ts
  /** Add a co-applicant to an existing OPEN case (ADR-0053). Dedupe is advisory + captured per
   *  applicant (mirrors create). Allowed only while the case is NEW or IN_PROGRESS. */
  async addApplicant(caseId: string, input: unknown, userId: string): Promise<CaseApplicant> {
    const v = AddApplicantSchema.parse(input);
    const status = await repo.caseStatusOf(caseId);
    if (!status) throw AppError.notFound('CASE_NOT_FOUND');
    if (status !== 'NEW' && status !== 'IN_PROGRESS') throw AppError.conflict('CASE_NOT_OPEN');
    return repo.addApplicant(caseId, v, userId);
  },
```

- [ ] **Step 2: Add the controller handler** (in `controller.ts`, after `addTasks`, ~line 110)

```ts
  async addApplicant(req: Request, res: Response, next: NextFunction) {
    try {
      res.status(HTTP_STATUS.CREATED).json(await svc.addApplicant(parseId(req), req.body, userId(req)));
    } catch (e) {
      next(e);
    }
  },
```

- [ ] **Step 3: Add the route** (in `routes.ts`, immediately after the `/:id/tasks` POST at line 21)

```ts
// Add a co-applicant to an existing OPEN case (ADR-0053). Same actor as case creation (case.create);
// dedupe verdict carried in the body; 409 CASE_NOT_OPEN once the case is COMPLETED/CANCELLED.
caseRoutes.post('/:id/applicants', authorize(PERMISSIONS.CASE_CREATE), c.addApplicant);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @crm2/api exec tsc -p tsconfig.json --noEmit`
Expected: PASS.

---

## Task 5: API — integration tests for add-applicant

**Files:**
- Modify: `apps/api/src/modules/cases/__tests__/cases.api.test.ts`

Read the file first to reuse its existing helpers (a `request`/supertest app handle, a login/token helper for roles, and a `createCase` helper). Mirror the existing dedupe/create/addTasks tests' setup. The cases below assume helpers named like the file's existing ones — adapt names to what the file actually uses.

- [ ] **Step 1: Write the failing tests** (add a `describe('POST /cases/:id/applicants (ADR-0053)')` block)

```ts
describe('POST /cases/:id/applicants (ADR-0053)', () => {
  it('adds a co-applicant to a NEW case (201) as CO_APPLICANT/non-primary with NULL-less dedupe', async () => {
    const c = await createCase(); // existing helper → a NEW case with one primary applicant
    const res = await request(app)
      .post(`/api/v2/cases/${c.id}/applicants`)
      .set(authHeader(managerToken)) // a role holding case.create
      .send({ name: 'Sita Rao', mobile: '9990001111', dedupeDecision: 'NO_DUPLICATES_FOUND' });
    expect(res.status).toBe(201);
    expect(res.body.applicantType).toBe('CO_APPLICANT');
    expect(res.body.isPrimary).toBe(false);
    expect(res.body.dedupeDecision).toBe('NO_DUPLICATES_FOUND');

    // and it shows up on the case detail
    const detail = await request(app).get(`/api/v2/cases/${c.id}`).set(authHeader(managerToken));
    expect(detail.body.applicants.map((a: { name: string }) => a.name)).toContain('Sita Rao');
  });

  it('requires a rationale for CREATE_NEW (400)', async () => {
    const c = await createCase();
    const res = await request(app)
      .post(`/api/v2/cases/${c.id}/applicants`)
      .set(authHeader(managerToken))
      .send({ name: 'Dup Person', dedupeDecision: 'CREATE_NEW' });
    expect(res.status).toBe(400);
  });

  it('accepts CREATE_NEW with a rationale (201) and stores matched case numbers', async () => {
    const c = await createCase();
    const res = await request(app)
      .post(`/api/v2/cases/${c.id}/applicants`)
      .set(authHeader(managerToken))
      .send({
        name: 'Dup Person',
        dedupeDecision: 'CREATE_NEW',
        dedupeRationale: 'same name, different applicant',
        dedupeMatches: ['CASE-000001'],
      });
    expect(res.status).toBe(201);
    expect(res.body.dedupeMatchedCaseNumbers).toEqual(['CASE-000001']);
  });

  it('rejects adding to a COMPLETED/CANCELLED case (409 CASE_NOT_OPEN)', async () => {
    const c = await createCompletedOrCancelledCase(); // drive a case to COMPLETED (or CANCELLED) via existing helpers
    const res = await request(app)
      .post(`/api/v2/cases/${c.id}/applicants`)
      .set(authHeader(managerToken))
      .send({ name: 'Late', dedupeDecision: 'NO_DUPLICATES_FOUND' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('CASE_NOT_OPEN');
  });

  it('404 for an unknown case id', async () => {
    const res = await request(app)
      .post(`/api/v2/cases/00000000-0000-0000-0000-000000000000/applicants`)
      .set(authHeader(managerToken))
      .send({ name: 'Ghost', dedupeDecision: 'NO_DUPLICATES_FOUND' });
    expect(res.status).toBe(404);
  });

  it('forbids a viewer-only role without case.create (403)', async () => {
    const c = await createCase();
    const res = await request(app)
      .post(`/api/v2/cases/${c.id}/applicants`)
      .set(authHeader(viewerToken)) // a role with case.view but NOT case.create (e.g. FIELD_AGENT)
      .send({ name: 'Sita', dedupeDecision: 'NO_DUPLICATES_FOUND' });
    expect(res.status).toBe(403);
  });
});
```

If the file lacks a `createCompletedOrCancelledCase`/`viewerToken` helper, build the COMPLETED/CANCELLED state with the existing task-complete/finalize helpers, and reuse whatever existing token represents a `case.view`-only role.

- [ ] **Step 2: Run to verify they fail, then pass after Tasks 3–4**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/crm2_test LC_ALL=C pnpm --filter @crm2/api test -- cases.api`
Expected: PASS for all six cases (with Tasks 3–4 implemented).

- [ ] **Step 3: Commit (API slice)**

```bash
git add apps/api/src/modules/cases/repository.ts apps/api/src/modules/cases/service.ts \
        apps/api/src/modules/cases/controller.ts apps/api/src/modules/cases/routes.ts \
        apps/api/src/modules/cases/__tests__/cases.api.test.ts
git commit -m "feat(cases): POST /cases/:id/applicants add-applicant with dedupe-on-add (ADR-0053)"
```

---

## Task 6: OpenAPI regen

**Files:**
- Modify: `apps/api/openapi.json` (generated)

- [ ] **Step 1: Regenerate**

Run: `pnpm --filter @crm2/api openapi` (or the repo's documented regen script; confirm by `grep -i openapi apps/api/package.json`).
Expected: the diff adds a `/api/v2/cases/{id}/applicants` POST entry consistent with the other generated `cases` routes; no unrelated churn.

- [ ] **Step 2: Commit**

```bash
git add apps/api/openapi.json
git commit -m "chore(api): regen openapi for POST /cases/:id/applicants (ADR-0053)"
```

---

## Task 7: Web — batch dedupe at creation

**Files:**
- Create: `apps/web/src/features/cases/dedupeBatch.ts`
- Create: `apps/web/src/features/cases/dedupeBatch.test.ts`
- Modify: `apps/web/src/features/cases/CaseCreatePage.tsx`

- [ ] **Step 1: Write the failing helper test** (`dedupeBatch.test.ts`)

```ts
import { describe, it, expect } from 'vitest';
import { summarizeDedupe, type DedupeGroup } from './dedupeBatch.js';

const match = (caseNumber: string) =>
  ({ caseId: 'x', caseNumber, applicantName: 'A', mobile: null, pan: null, companyName: null,
     status: 'NEW', clientName: 'C', createdAt: '', matchType: ['NAME'] }) as DedupeGroup['matches'][number];

describe('summarizeDedupe (ADR-0053 batch dedupe)', () => {
  it('NO_DUPLICATES_FOUND when every applicant is clean', () => {
    const groups: DedupeGroup[] = [
      { index: 0, label: 'Applicant', name: 'Ravi', matches: [] },
      { index: 1, label: 'Co-applicant 1', name: 'Sita', matches: [] },
    ];
    expect(summarizeDedupe(groups)).toEqual({ decision: 'NO_DUPLICATES_FOUND', matchedCaseNumbers: [] });
  });

  it('CREATE_NEW + de-duplicated union of case numbers when ANY applicant matches', () => {
    const groups: DedupeGroup[] = [
      { index: 0, label: 'Applicant', name: 'Ravi', matches: [match('CASE-000001'), match('CASE-000002')] },
      { index: 1, label: 'Co-applicant 1', name: 'Sita', matches: [match('CASE-000002')] },
    ];
    expect(summarizeDedupe(groups)).toEqual({
      decision: 'CREATE_NEW',
      matchedCaseNumbers: ['CASE-000001', 'CASE-000002'],
    });
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @crm2/web test -- dedupeBatch`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper** (`dedupeBatch.ts`)

```ts
import type { DuplicateMatch, DedupeDecision } from '@crm2/sdk';

/** One applicant's dedupe result group (which of MY applicants matched which existing cases). */
export interface DedupeGroup {
  index: number;
  label: string; // 'Applicant' | 'Co-applicant N'
  name: string;
  matches: DuplicateMatch[];
}

/** Roll per-applicant groups up to the case-level decision + the de-duplicated matched case numbers. */
export function summarizeDedupe(groups: DedupeGroup[]): {
  decision: DedupeDecision;
  matchedCaseNumbers: string[];
} {
  const numbers = new Set<string>();
  for (const g of groups) for (const m of g.matches) numbers.add(m.caseNumber);
  const matchedCaseNumbers = [...numbers].sort();
  return {
    decision: matchedCaseNumbers.length > 0 ? 'CREATE_NEW' : 'NO_DUPLICATES_FOUND',
    matchedCaseNumbers,
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @crm2/web test -- dedupeBatch`
Expected: PASS.

- [ ] **Step 5: Wire the helper into `CaseCreatePage.tsx`**

Replace the primary-only `dedupe` mutation (current lines ~75-87) so it searches **every applicant with ≥1 identifier**, stores `DedupeGroup[]`, and derives the case-level decision from the helper:

```tsx
import { summarizeDedupe, type DedupeGroup } from './dedupeBatch.js';

// state: const [groups, setGroups] = useState<DedupeGroup[]>([]);
const dedupe = useMutation({
  mutationFn: async (): Promise<DedupeGroup[]> => {
    const labelOf = (i: number) => (i === 0 ? 'Applicant' : `Co-applicant ${i}`);
    const searchable = applicants
      .map((a, index) => ({ a, index }))
      .filter(({ a }) => a.name.trim() || a.mobile.trim() || a.pan.trim());
    const results = await Promise.all(
      searchable.map(async ({ a, index }) => ({
        index,
        label: labelOf(index),
        name: a.name.trim(),
        matches: await api<DuplicateMatch[]>('POST', '/api/v2/cases/dedupe', {
          ...(a.name.trim() ? { name: a.name.trim() } : {}),
          ...(a.mobile.trim() ? { mobile: a.mobile.trim() } : {}),
          ...(a.pan.trim() ? { pan: a.pan.trim() } : {}),
        }),
      })),
    );
    return results;
  },
  onSuccess: (g) => {
    setGroups(g);
    setHasSearched(true);
  },
});
```

Then update the derived values + the create payload:

```tsx
const summary = summarizeDedupe(groups);
const hasMatches = hasSearched && summary.matchedCaseNumbers.length > 0;
const decision = summary.decision; // 'CREATE_NEW' | 'NO_DUPLICATES_FOUND'
// ...in create mutation body:
//   dedupeDecision: decision,
//   ...(hasMatches ? { dedupeRationale: rationale.trim(), dedupeMatches: summary.matchedCaseNumbers } : {}),
```

And replace the single results table with a **per-group** render: for each `DedupeGroup`, a sub-heading `"{label} ({name}) — N match(es)"` and, when `matches.length`, the existing match table (Case / Applicant / Mobile / PAN / Client / Status / Matched). When all groups are empty, keep the existing "No duplicates found — safe to create" panel. Keep the existing rationale textarea, shown only when `hasMatches`. Keep `armSearch()` (re-arm on any applicant edit) — it already covers co-applicants since `setApplicant` calls it.

- [ ] **Step 6: Typecheck + web tests**

Run: `pnpm --filter @crm2/web exec tsc -p tsconfig.json --noEmit && pnpm --filter @crm2/web test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/features/cases/dedupeBatch.ts apps/web/src/features/cases/dedupeBatch.test.ts \
        apps/web/src/features/cases/CaseCreatePage.tsx
git commit -m "feat(web): batch dedupe across all applicants at case creation (ADR-0053)"
```

---

## Task 8: Web — inline "Add applicant" on the case detail page

**Files:**
- Modify: `apps/web/src/features/cases/CaseDetailPage.tsx` (Applicants section ~line 141-177)

- [ ] **Step 1: Add an `AddApplicantForm` component + render it under the Applicants table**

Below the applicants `<table>` (after line 176, inside the Applicants card), render the form **only when** the actor can create AND the case is open:

```tsx
{canCreate && (data.status === 'NEW' || data.status === 'IN_PROGRESS') && (
  <div className="border-t border-border p-3">
    <AddApplicantForm caseId={id} />
  </div>
)}
```

`canCreate` already exists in this component (passed to `TasksSection`). Implement `AddApplicantForm` near the other section components:

```tsx
import type { DuplicateMatch } from '@crm2/sdk';
import { PAN_REGEX, PHONE_REGEX } from '@crm2/sdk';

function AddApplicantForm({ caseId }: { caseId: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [mobile, setMobile] = useState('');
  const [pan, setPan] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [rationale, setRationale] = useState('');
  const [searched, setSearched] = useState(false);

  const reArm = () => setSearched(false);
  const onlyDigits = (v: string) => v.replace(/\D/g, '');
  const phoneOk = mobile.trim() === '' || PHONE_REGEX.test(mobile.trim());
  const panOk = pan.trim() === '' || PAN_REGEX.test(pan.trim());
  const canSearch = Boolean(name.trim() || mobile.trim() || pan.trim());

  const dedupe = useMutation({
    mutationFn: () =>
      api<DuplicateMatch[]>('POST', '/api/v2/cases/dedupe', {
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(mobile.trim() ? { mobile: mobile.trim() } : {}),
        ...(pan.trim() ? { pan: pan.trim() } : {}),
      }),
    onSuccess: () => setSearched(true),
  });
  const matches = dedupe.data ?? [];
  const hasMatches = searched && matches.length > 0;

  const add = useMutation({
    mutationFn: () =>
      api('POST', `/api/v2/cases/${caseId}/applicants`, {
        name: name.trim(),
        ...(mobile.trim() ? { mobile: mobile.trim() } : {}),
        ...(pan.trim() ? { pan: pan.trim().toUpperCase() } : {}),
        ...(companyName.trim() ? { companyName: companyName.trim() } : {}),
        dedupeDecision: hasMatches ? 'CREATE_NEW' : 'NO_DUPLICATES_FOUND',
        ...(hasMatches
          ? { dedupeRationale: rationale.trim(), dedupeMatches: matches.map((m) => m.caseNumber) }
          : {}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['case', caseId] });
      setName(''); setMobile(''); setPan(''); setCompanyName(''); setRationale(''); setSearched(false);
    },
  });

  const rationaleOk = !hasMatches || rationale.trim().length >= 5;
  const canAdd = Boolean(name.trim()) && phoneOk && panOk && searched && rationaleOk && !add.isPending;

  return (
    <div className="space-y-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Add co-applicant</div>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
        <input className="input" value={name} placeholder="Name"
          onChange={(e) => { reArm(); setName(e.target.value); }} />
        <input className="input" inputMode="numeric" maxLength={15} value={mobile} placeholder="Mobile (10–15 digits)"
          onChange={(e) => { reArm(); setMobile(onlyDigits(e.target.value)); }} />
        <input className="input" maxLength={10} value={pan} placeholder="PAN (ABCDE1234F)"
          onChange={(e) => { reArm(); setPan(e.target.value.toUpperCase()); }} />
        <input className="input" maxLength={200} value={companyName} placeholder="Company"
          onChange={(e) => setCompanyName(e.target.value)} />
      </div>
      {searched && (
        <div className="text-xs text-muted-foreground">
          {hasMatches
            ? `${matches.length} possible duplicate(s): ${matches.map((m) => m.caseNumber).join(', ')}`
            : 'No duplicates found.'}
        </div>
      )}
      {hasMatches && (
        <textarea className="input min-h-[3rem]" value={rationale} placeholder="Why add despite duplicates? (min 5 chars)"
          onChange={(e) => setRationale(e.target.value)} />
      )}
      <div className="flex items-center gap-2">
        <button className="btn-ghost" disabled={!canSearch || dedupe.isPending} onClick={() => dedupe.mutate()}>
          {dedupe.isPending ? 'Checking…' : 'Check duplicates'}
        </button>
        <button className="btn" disabled={!canAdd} onClick={() => add.mutate()}>
          {add.isPending ? 'Adding…' : 'Add applicant'}
        </button>
        {add.isError && <span className="text-sm text-destructive">Add failed.</span>}
      </div>
    </div>
  );
}
```

Confirm `useQueryClient`, `useState`, `useMutation`, and `api` are already imported in `CaseDetailPage.tsx` (they are — the page uses them). Match the page's existing `['case', id]` query key exactly so the table refreshes.

- [ ] **Step 2: Typecheck + web tests**

Run: `pnpm --filter @crm2/web exec tsc -p tsconfig.json --noEmit && pnpm --filter @crm2/web test`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/features/cases/CaseDetailPage.tsx
git commit -m "feat(web): inline add-applicant with dedupe-on-add on the case detail page (ADR-0053)"
```

---

## Task 9: Full verify + review gate (no push)

- [ ] **Step 1: Full verify**

Run: `DATABASE_URL=postgresql://postgres:postgres@localhost:5433/crm2_test LC_ALL=C pnpm verify`
Expected: GREEN (typecheck → lint → format → no-suppressions → boundaries → test → build), incl. `migrations.rerun.test.ts`.

- [ ] **Step 2: Commit the ADR + plan + memory**

```bash
git add docs/adr/ADR-0053-multi-applicant-batch-dedupe-and-post-creation-add.md \
        docs/plans/2026-06-20-adr-0053-multi-applicant-dedupe.md
git commit -m "docs(adr): ADR-0053 multi-applicant batch dedupe + post-creation add"
```

- [ ] **Step 3: 4-agent review gate** (CEO/product, CTO/architecture incl. migration re-run safety + additive-only + mobile, Design/UX, Security incl. RBAC/IDOR on the new endpoint + the dedupe-on-add gate). Address every BLOCKER; disposition findings in `docs/COMPLIANCE_GAPS_REGISTRY.md`.

- [ ] **Step 4: STOP — report to owner.** Summarize green verify + gate verdicts and **ask the owner for explicit OK to push** (push→main auto-deploys to prod). Owner verifies on prod (no local browser: policy-acceptance + MFA).

---

## Self-Review (author checklist — completed)

- **Spec coverage:** (A) batch-at-creation → Task 7; (B) add-applicant endpoint → Tasks 2–6; storage (mig 0087) → Task 1; status guard NEW/IN_PROGRESS → Task 4; CO_APPLICANT/non-primary → Task 3; company-out-of-search → Task 7 (search body sends only name/mobile/pan); edit/remove out of scope → not planned. ✓
- **Placeholders:** none — every code step has concrete code. The only adapt-to-existing notes are the API test helper names (Task 5), which depend on the actual `cases.api.test.ts` and are explicitly flagged to reconcile.
- **Type consistency:** `AddApplicantInput`/`AddApplicantSchema`/`CaseApplicant` used identically across SDK→repo→service→controller→client; `DedupeGroup`/`summarizeDedupe` consistent between helper, test, and CaseCreatePage; route path `/:id/applicants` matches the client `POST /api/v2/cases/${id}/applicants`. ✓
- **Re-run safety:** 0087 is `ADD COLUMN IF NOT EXISTS` + guarded `ADD CONSTRAINT`; pre-existing rows are NULL → CHECK never rejects (Task 1). ✓
