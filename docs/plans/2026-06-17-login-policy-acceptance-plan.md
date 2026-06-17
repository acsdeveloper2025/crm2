# Login Policy Acceptance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every user must accept an admin-managed, versioned policy at login before using the app — server-driven gate (login + refresh), policies CRUD admin screen, immutable acceptance audit.

**Architecture:** Mirrors the existing `mustChangePassword` login gate (server computes a flag, FE blocks into a full-screen page, refresh re-checks). Policies are a standard admin entity (mirrors `verificationUnits`): OCC `version` (ADR-0019), `effective_from` (ADR-0017), audit-logged. A separate `content_version` drives re-acceptance. Gate queries live in the auth module; CRUD in a new `policies` module.

**Tech stack:** Express + raw `pg` (repository pattern), zod via `@crm2/sdk`, `@crm2/access` permissions, React + TanStack Query + the frozen DataGrid, vitest + supertest, migration `0068`.

**Reference spec:** [docs/specs/2026-06-17-login-policy-acceptance-design.md](../specs/2026-06-17-login-policy-acceptance-design.md). **Numbers:** migration `0068`, ADR `0042`, FROZEN_DECISIONS_REGISTRY row `35`.

**Standing rules (every task):** author `Mayur Kulkarni <mayurkulkarni786@gmail.com>`, conventional commits, no AI trailer, never `--no-verify`. Commit at green gates. No `any`/suppressions/`console.*`. Raw SQL only in repositories. FE via `@crm2/sdk` only. Run the per-task command before committing; the final task runs full `pnpm verify`. Integration tests need `DATABASE_URL` (ephemeral PG on `:5433`, `LC_ALL=C`).

---

## File structure

**Create:**
- `db/v2/migrations/0068_policy_acceptance.sql` — two tables + seed perms + seed ACTIVE starter policy
- `packages/sdk/src/policies.ts` — Policy/PendingPolicy/acceptance contracts
- `apps/api/src/modules/policies/{repository,service,controller,routes}.ts` — admin CRUD
- `apps/api/src/modules/policies/__tests__/policies.api.test.ts`
- `apps/web/src/features/auth/MustAcceptPoliciesPage.tsx` — the gate screen
- `apps/web/src/features/policies/PoliciesPage.tsx` + `PolicyDialog.tsx` — admin screen
- `docs/adr/ADR-0042-login-policy-acceptance.md`

**Modify:**
- `packages/access/src/permissions.ts` — add `POLICY_MANAGE`, `POLICY_VIEW` + meta
- `packages/sdk/src/index.ts` — export `./policies.js`
- `packages/sdk/src/auth.ts:42-49` — extend `LoginResponse`
- `apps/api/src/modules/auth/repository.ts` — `pendingPoliciesForUser` + `acceptPolicies`
- `apps/api/src/modules/auth/service.ts:119-152,202-223` — login + refresh gate; `acceptPolicies`
- `apps/api/src/modules/auth/controller.ts` + `routes.ts` — `POST /accept-policies`
- `apps/api/src/modules/auth/__tests__/*` — gate tests
- `apps/api/src/http/app.ts:92` — mount `/api/v2/policies`
- `apps/web/src/lib/AuthContext.tsx` — `mustAcceptPolicies` + `pendingPolicies` + `acceptPolicies()`
- `apps/web/src/App.tsx:34-52` — insert the gate
- `apps/web/src/components/Layout.tsx:44` — ADMINISTRATION nav entry
- `docs/FROZEN_DECISIONS_REGISTRY.md` (row 35), `docs/engineering/MOBILE_API_COMPATIBILITY_MATRIX.md`, `PROJECT_INDEX.md`

---

## Task 1: Migration 0068 — tables, permissions seed, ACTIVE starter policy

**Files:**
- Create: `db/v2/migrations/0068_policy_acceptance.sql`

- [ ] **Step 1: Write the migration**

Port the policy text verbatim from `/Users/mayurkulkarni/Downloads/CRM-APP-MONOREPO-PROD/CRM-FRONTEND/src/constants/fieldExecutiveAcknowledgement.ts` (the `FIELD_EXECUTIVE_ACKNOWLEDGEMENT` constant, 10 sections). Use dollar-quoting `$policy$ … $policy$` so apostrophes need no escaping.

```sql
-- 0068_policy_acceptance.sql — Login policy acceptance (ADR-0042).
-- Admin-managed, versioned policies; every user must accept all active+effective policies before
-- the app loads (server-driven gate: login returns mustAcceptPolicies, refresh re-checks). Mirrors
-- the mustChangePassword gate. Forward-only, idempotent.

BEGIN;

-- Admin-managed policy documents. `content_version` drives re-acceptance (bumps on content publish);
-- `version` is OCC (ADR-0019, bumps every edit). Usable ⇔ is_active AND effective_from <= now() (ADR-0017).
CREATE TABLE IF NOT EXISTS policies (
    id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code            varchar(50)  NOT NULL,
    name            varchar(150) NOT NULL,
    description     text,
    content         text         NOT NULL,
    content_version integer      NOT NULL DEFAULT 1,
    is_active       boolean      NOT NULL DEFAULT false,
    effective_from  timestamptz  NOT NULL DEFAULT now(),
    version         integer      NOT NULL DEFAULT 1,
    created_by      uuid,
    updated_by      uuid,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_policies_code CHECK (code ~ '^[A-Z][A-Z0-9_]*$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_policies_code_active ON policies (code) WHERE is_active;

-- One immutable row per (user, policy, content_version) — the audit of who accepted what, when.
CREATE TABLE IF NOT EXISTS policy_acceptances (
    id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id         uuid    NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    policy_id       integer NOT NULL REFERENCES policies (id) ON DELETE RESTRICT,
    content_version integer NOT NULL,
    ip              inet,
    user_agent      text,
    source          varchar(10) NOT NULL DEFAULT 'WEB' CHECK (source IN ('WEB','MOBILE')),
    accepted_at     timestamptz NOT NULL DEFAULT now(),
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_policy_acceptances_user ON policy_acceptances (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_policy_acceptances_user_policy_ver
    ON policy_acceptances (user_id, policy_id, content_version);

-- Permission seed (SUPER_ADMIN has grants_all → holds no explicit rows; grant the office admin roles
-- the read perm so the nav shows). Writes (policy.manage) stay SUPER_ADMIN-only.
INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER', 'page.policies')
ON CONFLICT (role_code, permission_code) DO NOTHING;

-- Seed the Field-Exec Acknowledgement as the first ACTIVE policy → every user is gated to accept it
-- on next login post-deploy (intended). Guarded so a re-run never duplicates.
INSERT INTO policies (code, name, description, content, content_version, is_active)
SELECT 'FIELD_EXEC_ACKNOWLEDGEMENT',
       'Field Executive Acknowledgement',
       'Code of conduct, anti-bribery, confidentiality, data & location consent (DPDP).',
       $policy$<<< PASTE the full FIELD_EXECUTIVE_ACKNOWLEDGEMENT text (10 sections) verbatim from the v1 file here >>>$policy$,
       1, true
WHERE NOT EXISTS (SELECT 1 FROM policies WHERE code = 'FIELD_EXEC_ACKNOWLEDGEMENT');

COMMIT;
```

- [ ] **Step 2: Apply it to the dev + test DBs**

Run (dev `:54329` + ephemeral test `:5433` — the harness only migrates `:5433` automatically, dev is manual per the kickoff):
```bash
psql "postgresql://postgres@127.0.0.1:54329/crm2_dev" -v ON_ERROR_STOP=1 -f db/v2/migrations/0068_policy_acceptance.sql
```
Expected: `CREATE TABLE` ×2, `CREATE INDEX` ×3, `INSERT 0 1` ×2, `COMMIT`.

- [ ] **Step 3: Verify the tables + active seed**

Run:
```bash
psql "postgresql://postgres@127.0.0.1:54329/crm2_dev" -c "SELECT code, is_active, content_version, length(content) FROM policies;"
```
Expected: one row, `FIELD_EXEC_ACKNOWLEDGEMENT | t | 1 | >2000`.

- [ ] **Step 4: Commit**

```bash
git add db/v2/migrations/0068_policy_acceptance.sql
git commit -m "feat(db): migration 0068 — policies + policy_acceptances + active starter policy"
```

---

## Task 2: Permissions — `policy.manage` + `page.policies`

**Files:**
- Modify: `packages/access/src/permissions.ts`

- [ ] **Step 1: Add the permission codes**

In the `PERMISSIONS` object (after the user-admin block), add:
```typescript
  POLICY_VIEW: 'page.policies',
  POLICY_MANAGE: 'policy.manage',
```

- [ ] **Step 2: Add their metadata**

In `PERMISSION_META`, add:
```typescript
  'page.policies': { label: 'Policies — View', group: 'Administration' },
  'policy.manage': { label: 'Policies — Manage', group: 'Administration' },
```

- [ ] **Step 3: Build + typecheck the package**

Run: `pnpm --filter @crm2/access build && pnpm --filter @crm2/access typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/access/src/permissions.ts
git commit -m "feat(access): add policy.manage + page.policies permissions"
```

---

## Task 3: SDK contracts

**Files:**
- Create: `packages/sdk/src/policies.ts`
- Modify: `packages/sdk/src/index.ts`, `packages/sdk/src/auth.ts`

- [ ] **Step 1: Write `policies.ts`**

```typescript
import { z } from 'zod';

/** @crm2/sdk — Policy acceptance (ADR-0042). Admin-managed, versioned policies a user must accept
 *  at login. `contentVersion` drives re-acceptance; `version` is the OCC token (ADR-0019). */
export interface Policy {
  id: number;
  code: string;
  name: string;
  description: string | null;
  content: string;
  contentVersion: number;
  isActive: boolean;
  effectiveFrom: string;
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The minimal shape the login gate sends the client for a policy awaiting acceptance. */
export interface PendingPolicy {
  id: number;
  code: string;
  name: string;
  content: string;
  contentVersion: number;
}

export interface PolicyAcceptance {
  id: number;
  userId: string;
  policyId: number;
  contentVersion: number;
  source: 'WEB' | 'MOBILE';
  acceptedAt: string;
}

const codeField = z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'code must be UPPER_SNAKE');

export const CreatePolicySchema = z.object({
  code: codeField,
  name: z.string().min(1),
  description: z.string().nullish(),
  content: z.string().min(1),
});
export type CreatePolicyInput = z.infer<typeof CreatePolicySchema>;

/** Update: every field optional; `version` (OCC) required is enforced server-side (400 VERSION_REQUIRED). */
export const UpdatePolicySchema = z
  .object({ code: codeField, name: z.string().min(1), description: z.string().nullish(), content: z.string().min(1) })
  .partial();
export type UpdatePolicyInput = z.infer<typeof UpdatePolicySchema>;

export const EffectiveFromSchema = z.object({ effectiveFrom: z.string().datetime().optional() });

/** Self-service acceptance: the user accepts a set of pending policy ids. Source defaults to WEB. */
export const AcceptPoliciesSchema = z.object({
  policyIds: z.array(z.number().int().positive()).min(1),
  source: z.enum(['WEB', 'MOBILE']).default('WEB'),
});
export type AcceptPoliciesInput = z.input<typeof AcceptPoliciesSchema>;
```

- [ ] **Step 2: Export it**

In `packages/sdk/src/index.ts`, add next to the other exports:
```typescript
export * from './policies.js';
```

- [ ] **Step 3: Extend `LoginResponse`**

In `packages/sdk/src/auth.ts`, add the import at the top and the two fields to `LoginResponse`:
```typescript
import type { PendingPolicy } from './policies.js';
```
```typescript
export interface LoginResponse {
  user: AuthUser;
  tokens: AuthTokens;
  mustChangePassword: boolean;
  mustEnrollMfa: boolean;
  /** true when the user has unaccepted active policies — the FE blocks into the accept screen. */
  mustAcceptPolicies: boolean;
  /** the active policies this user still owes acceptance for (empty when mustAcceptPolicies is false). */
  pendingPolicies: PendingPolicy[];
}
```

- [ ] **Step 4: Build the SDK**

Run: `pnpm --filter @crm2/sdk build && pnpm --filter @crm2/sdk typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sdk/src/policies.ts packages/sdk/src/index.ts packages/sdk/src/auth.ts
git commit -m "feat(sdk): policy contracts + mustAcceptPolicies on LoginResponse"
```

---

## Task 4: Auth gate — repository queries (TDD)

**Files:**
- Modify: `apps/api/src/modules/auth/repository.ts`
- Test: `apps/api/src/modules/auth/__tests__/policyGate.api.test.ts` (created in Task 6)

- [ ] **Step 1: Add the two gate queries to `authRepository`**

Append inside the `authRepository` object:
```typescript
  /** Active+effective policies this user has NOT accepted at the current content_version (ADR-0042). */
  async pendingPoliciesForUser(userId: string): Promise<
    { id: number; code: string; name: string; content: string; contentVersion: number }[]
  > {
    return query(
      `SELECT p.id, p.code, p.name, p.content, p.content_version
         FROM policies p
        WHERE p.is_active = true AND p.effective_from <= now()
          AND NOT EXISTS (
            SELECT 1 FROM policy_acceptances pa
             WHERE pa.user_id = $1 AND pa.policy_id = p.id AND pa.content_version = p.content_version)
        ORDER BY p.created_at`,
      [userId],
    );
  },

  /** Record acceptance for the given active policy ids, snapshotting the SERVER-side content_version
   *  (the client's claim is ignored). Idempotent. Returns the number of policies accepted. */
  async acceptPolicies(
    userId: string,
    policyIds: number[],
    ip: string | null,
    userAgent: string | null,
    source: 'WEB' | 'MOBILE',
  ): Promise<number> {
    const rows = await query<{ policyId: number }>(
      `INSERT INTO policy_acceptances (user_id, policy_id, content_version, ip, user_agent, source)
       SELECT $1, p.id, p.content_version, $3::inet, $4, $5
         FROM policies p
        WHERE p.id = ANY($2::int[]) AND p.is_active = true AND p.effective_from <= now()
       ON CONFLICT (user_id, policy_id, content_version) DO NOTHING
       RETURNING policy_id`,
      [userId, policyIds, ip, userAgent, source],
    );
    return rows.length;
  },
```

- [ ] **Step 2: Build the api package types**

Run: `pnpm --filter @crm2/api typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/auth/repository.ts
git commit -m "feat(api): auth repo — pendingPoliciesForUser + acceptPolicies gate queries"
```

---

## Task 5: Auth gate — service + controller + route (TDD)

**Files:**
- Modify: `apps/api/src/modules/auth/service.ts`, `controller.ts`, `routes.ts`

- [ ] **Step 1: Add the gate to `login()`**

In `service.ts`, import the accept schema at the top:
```typescript
import { AcceptPoliciesSchema, /* …existing… */ } from '@crm2/sdk';
```
At the end of `login()`, replace the `return { … }` with:
```typescript
    const pendingPolicies = await repo.pendingPoliciesForUser(creds.id);
    return {
      user: await withResolvedPermissions(user),
      tokens,
      mustChangePassword: creds.passwordMustChange || expired,
      mustEnrollMfa: creds.mfaRequired && !creds.mfaEnrolled,
      mustAcceptPolicies: pendingPolicies.length > 0,
      pendingPolicies,
    };
```

- [ ] **Step 2: Re-check on `refresh()`**

In `refresh()`, immediately after the `passwordExpired(...) throw invalidRefresh()` line (`service.ts:213`), add:
```typescript
    if ((await repo.pendingPoliciesForUser(claims.userId)).length > 0) throw invalidRefresh();
```

- [ ] **Step 3: Add the `acceptPolicies` service method**

Add to the `authService` object:
```typescript
  /** Self-service: record the user's acceptance of the given pending policy ids (ADR-0042). */
  async acceptPolicies(userId: string, input: unknown, ip: string | null, userAgent: string | null): Promise<void> {
    const v = AcceptPoliciesSchema.parse(input);
    await repo.acceptPolicies(userId, v.policyIds, ip, userAgent, v.source);
  },
```

- [ ] **Step 4: Add the controller handler**

In `controller.ts`, add to `authController`:
```typescript
  async acceptPolicies(req: Request, res: Response, next: NextFunction) {
    try {
      await svc.acceptPolicies(requireUserId(req), req.body, req.ip ?? null, req.get('user-agent') ?? null);
      res.status(HTTP_STATUS.OK).json({ ok: true });
    } catch (e) {
      next(e);
    }
  },
```

- [ ] **Step 5: Add the route (self-service, authenticated, no permission)**

In `routes.ts`, after the change-password line (`:18`):
```typescript
// Self-service policy acceptance (ADR-0042) — authenticated (req.auth); records the user's consent.
authRoutes.post('/accept-policies', c.acceptPolicies);
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @crm2/api typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/auth/service.ts apps/api/src/modules/auth/controller.ts apps/api/src/modules/auth/routes.ts
git commit -m "feat(api): login/refresh policy gate + POST /auth/accept-policies"
```

---

## Task 6: Auth gate — integration tests (TDD)

**Files:**
- Create: `apps/api/src/modules/auth/__tests__/policyGate.api.test.ts`

> The harness seeds the schema (migrations) + roles. The migration's starter policy is active, so a
> freshly-seeded user is gated by default. Tests truncate `policies` + `policy_acceptances` to control state.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const USER_ID = '00000000-0000-0000-0000-000000000001';

async function seedActivePolicy(code = 'TESTPOL', contentVersion = 1) {
  await db!.pool.query(
    `INSERT INTO policies (code, name, content, content_version, is_active) VALUES ($1,$1,'body',$2,true)`,
    [code, contentVersion],
  );
}

describe.skipIf(!RUN)('policy gate API', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate('policy_acceptances', 'policies');
  });

  it('GET pending via accept then no-op: accepting an active policy records one row, idempotently', async () => {
    await seedActivePolicy('POLA');
    const { rows } = await db!.pool.query<{ id: number }>(`SELECT id FROM policies WHERE code='POLA'`);
    const id = rows[0]!.id;

    const first = await request(app).post('/api/v2/auth/accept-policies').set(SA).send({ policyIds: [id] });
    expect(first.status).toBe(200);
    const again = await request(app).post('/api/v2/auth/accept-policies').set(SA).send({ policyIds: [id] });
    expect(again.status).toBe(200);

    const count = await db!.pool.query(
      `SELECT count(*)::int AS n FROM policy_acceptances WHERE user_id=$1 AND policy_id=$2`,
      [USER_ID, id],
    );
    expect(count.rows[0].n).toBe(1); // idempotent — no duplicate
  });

  it('bumping content_version re-gates an already-accepted policy', async () => {
    await seedActivePolicy('POLB', 1);
    const { rows } = await db!.pool.query<{ id: number }>(`SELECT id FROM policies WHERE code='POLB'`);
    const id = rows[0]!.id;
    await db!.pool.query(`INSERT INTO policy_acceptances (user_id, policy_id, content_version) VALUES ($1,$2,1)`, [USER_ID, id]);

    // accepted v1 → clear
    const before = await db!.pool.query(
      `SELECT count(*)::int AS n FROM policies p WHERE p.is_active AND p.effective_from<=now()
         AND NOT EXISTS (SELECT 1 FROM policy_acceptances pa WHERE pa.user_id=$1 AND pa.policy_id=p.id AND pa.content_version=p.content_version)`,
      [USER_ID],
    );
    expect(before.rows[0].n).toBe(0);

    await db!.pool.query(`UPDATE policies SET content_version=2 WHERE id=$1`, [id]);
    const after = await db!.pool.query(
      `SELECT count(*)::int AS n FROM policies p WHERE p.is_active AND p.effective_from<=now()
         AND NOT EXISTS (SELECT 1 FROM policy_acceptances pa WHERE pa.user_id=$1 AND pa.policy_id=p.id AND pa.content_version=p.content_version)`,
      [USER_ID],
    );
    expect(after.rows[0].n).toBe(1); // re-gated
  });

  it('accept-policies rejects an unknown/empty body (400)', async () => {
    const res = await request(app).post('/api/v2/auth/accept-policies').set(SA).send({ policyIds: [] });
    expect(res.status).toBe(400);
  });

  it('accept-policies requires authentication (401)', async () => {
    const res = await request(app).post('/api/v2/auth/accept-policies').send({ policyIds: [1] });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the tests (must fail first, then pass after Tasks 4–5)**

Run: `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/crm2_test pnpm --filter @crm2/api test -- policyGate`
Expected: PASS (Tasks 4–5 implemented the behavior). If the route 404s, re-check Task 5 step 5.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/auth/__tests__/policyGate.api.test.ts
git commit -m "test(api): policy login-gate — accept idempotency, content-bump re-gate, 400/401"
```

---

## Task 7: Policies admin module (mirror `verificationUnits`)

**Files:**
- Create: `apps/api/src/modules/policies/{repository,service,controller,routes}.ts`
- Modify: `apps/api/src/http/app.ts:92`

> **Mirror** `apps/api/src/modules/verificationUnits/{repository,service,controller,routes}.ts` exactly,
> substituting the `policies` table/columns. Below are the policy-specific pieces; everything else
> (list pagination envelope, get, OCC update plumbing, audit calls, `parseId`/`userId` helpers,
> try/catch controller wrappers) is copied 1:1 from the reference with `verification_units` → `policies`.

- [ ] **Step 1: `repository.ts` — columns + CRUD + content_version bump**

```typescript
import { query, withTransaction } from '../../platform/db.js';
import { appendAudit } from '../../platform/audit.js';
import { AppError } from '../../platform/errors.js';
import type { Policy } from '@crm2/sdk';

const COLS = `id, code, name, description, content, content_version, is_active, effective_from,
  version, created_by, updated_by, created_at, updated_at`;

interface WriteInput {
  code: string;
  name: string;
  description: string | null;
  content: string;
  effectiveFrom: string | undefined;
}

export const policyRepository = {
  // list(): copy verificationUnits.list 1:1 (same pagination envelope), table = policies, default sort 'createdAt'.
  async findById(id: number): Promise<Policy | null> {
    const rows = await query<Policy>(`SELECT ${COLS} FROM policies WHERE id = $1`, [id]);
    return rows[0] ?? null;
  },

  async create(input: WriteInput, userId: string): Promise<Policy> {
    return withTransaction(async (q) => {
      const [row] = await q<Policy>(
        `INSERT INTO policies (code, name, description, content, effective_from, created_by, updated_by)
         VALUES ($1,$2,$3,$4, COALESCE($5::timestamptz, now()), $6, $6)
         RETURNING ${COLS}`,
        [input.code, input.name, input.description, input.content, input.effectiveFrom ?? null, userId],
      );
      if (!row) throw AppError.internal('insert returned no row');
      await appendAudit({ entityType: 'policies', entityId: row.id, action: 'CREATE', actorId: userId, after: row, versionAfter: row.version }, q);
      return row;
    });
  },

  /** OCC-guarded update (ADR-0019). `bumpContent` ⇒ content_version + 1 (forces global re-accept). */
  async update(id: number, input: WriteInput, bumpContent: boolean, userId: string, expectedVersion: number, before: Policy): Promise<Policy> {
    return withTransaction(async (q) => {
      const [row] = await q<Policy>(
        `UPDATE policies SET
           code=$2, name=$3, description=$4, content=$5,
           effective_from = COALESCE($6::timestamptz, effective_from),
           content_version = content_version + $7,
           version = version + 1, updated_by=$8, updated_at=now()
         WHERE id=$1 AND version=$9 RETURNING ${COLS}`,
        [id, input.code, input.name, input.description, input.content, input.effectiveFrom ?? null, bumpContent ? 1 : 0, userId, expectedVersion],
      );
      if (!row) {
        const [current] = await q<Policy>(`SELECT ${COLS} FROM policies WHERE id=$1`, [id]);
        if (!current) throw AppError.notFound('POLICY_NOT_FOUND');
        throw AppError.stale(current);
      }
      await appendAudit({ entityType: 'policies', entityId: id, action: 'UPDATE', actorId: userId, before, after: row, versionAfter: row.version }, q);
      return row;
    });
  },

  // setActive(id, isActive, userId, expectedVersion): copy verificationUnits.setActive 1:1 (table=policies).
  // acceptances(id): SELECT id, user_id, policy_id, content_version, source, accepted_at
  //   FROM policy_acceptances WHERE policy_id=$1 ORDER BY accepted_at DESC  (returns the audit list).
};
```

- [ ] **Step 2: `service.ts` — content-change detection**

Mirror `verificationUnits/service.ts`; the only non-mechanical delta is detecting a content change:
```typescript
import { CreatePolicySchema, EffectiveFromSchema } from '@crm2/sdk';
// create(): const v = CreatePolicySchema.parse(input); const { effectiveFrom } = EffectiveFromSchema.parse(input);
//   return repo.create({ ...v, description: v.description ?? null, effectiveFrom }, userId);

  async update(id: number, patch: Record<string, unknown>, userId: string): Promise<Policy> {
    const expectedVersion = requireVersion(patch); // 400 VERSION_REQUIRED — copy the helper from verificationUnits
    const existing = await repo.findById(id);
    if (!existing) throw AppError.notFound('POLICY_NOT_FOUND');
    const merged = { ...existing, ...patch };
    const v = CreatePolicySchema.parse(merged);
    const { effectiveFrom } = EffectiveFromSchema.parse(patch);
    const bumpContent = patch['content'] !== undefined && patch['content'] !== existing.content;
    return repo.update(id, { ...v, description: v.description ?? null, effectiveFrom }, bumpContent, userId, expectedVersion, existing);
  },
  // activate/deactivate: => repo.setActive(...) — copy 1:1.
  // acceptances: (id) => repo.acceptances(id)
```

- [ ] **Step 3: `controller.ts`** — copy `verificationUnits/controller.ts` 1:1 (rename `verificationUnitController` → `policyController`, `svc` = policies service), plus one handler:
```typescript
  async acceptances(req: Request, res: Response, next: NextFunction) {
    try { res.json(await svc.acceptances(parseId(req))); } catch (e) { next(e); }
  },
```

- [ ] **Step 4: `routes.ts`**

```typescript
import { Router } from 'express';
import { authorize, PERMISSIONS } from '@crm2/access';
import { policyController as c } from './controller.js';

/** /api/v2/policies — reads page.policies; writes policy.manage (SUPER_ADMIN per seed). */
export const policyRoutes: Router = Router();
policyRoutes.get('/', authorize(PERMISSIONS.POLICY_VIEW), c.list);
policyRoutes.get('/:id', authorize(PERMISSIONS.POLICY_VIEW), c.get);
policyRoutes.get('/:id/acceptances', authorize(PERMISSIONS.POLICY_MANAGE), c.acceptances);
policyRoutes.post('/', authorize(PERMISSIONS.POLICY_MANAGE), c.create);
policyRoutes.put('/:id', authorize(PERMISSIONS.POLICY_MANAGE), c.update);
policyRoutes.post('/:id/activate', authorize(PERMISSIONS.POLICY_MANAGE), c.activate);
policyRoutes.post('/:id/deactivate', authorize(PERMISSIONS.POLICY_MANAGE), c.deactivate);
```

- [ ] **Step 5: Mount it** in `apps/api/src/http/app.ts` after the verification-units mount (`:92`):
```typescript
  mount('/api/v2/policies', policyRoutes);
```
(add the import: `import { policyRoutes } from '../modules/policies/routes.js';`)

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @crm2/api typecheck`  → Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/modules/policies apps/api/src/http/app.ts
git commit -m "feat(api): policies admin module (CRUD + OCC + content_version bump + acceptances)"
```

---

## Task 8: Policies admin module tests

**Files:**
- Create: `apps/api/src/modules/policies/__tests__/policies.api.test.ts`

- [ ] **Step 1: Write the tests** (mirror `verificationUnits.api.test.ts` harness)

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BE = authHeaderForRole('BACKEND_USER');
const newPolicy = (code = 'PRIVACY') => ({ code, name: 'Privacy', content: 'v1 body' });

describe.skipIf(!RUN)('policies admin API', () => {
  beforeAll(async () => { await db!.migrate(); setPool(db!.pool); });
  afterAll(async () => { await db!.end(); });
  beforeEach(async () => { await db!.truncate('policy_acceptances', 'policies', 'audit_log'); });

  it('SUPER_ADMIN creates (201), version=1, content_version=1', async () => {
    const r = await request(app).post('/api/v2/policies').set(SA).send(newPolicy());
    expect(r.status).toBe(201);
    expect(r.body.version).toBe(1);
    expect(r.body.contentVersion).toBe(1);
  });

  it('editing content bumps content_version; metadata-only edit does not', async () => {
    const c = await request(app).post('/api/v2/policies').set(SA).send(newPolicy('POLX'));
    const { id, version } = c.body;
    const meta = await request(app).put(`/api/v2/policies/${id}`).set(SA).send({ name: 'Renamed', version });
    expect(meta.status).toBe(200);
    expect(meta.body.contentVersion).toBe(1); // unchanged
    const edit = await request(app).put(`/api/v2/policies/${id}`).set(SA).send({ content: 'v2 body', version: meta.body.version });
    expect(edit.body.contentVersion).toBe(2); // bumped
  });

  it('stale update → 409 STALE_UPDATE', async () => {
    const c = await request(app).post('/api/v2/policies').set(SA).send(newPolicy('POLY'));
    const stale = await request(app).put(`/api/v2/policies/${c.body.id}`).set(SA).send({ name: 'x', version: 999 });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('STALE_UPDATE');
  });

  it('BACKEND_USER cannot write (403) and cannot view the list (403 — page.policies not granted to BE)', async () => {
    expect((await request(app).post('/api/v2/policies').set(BE).send(newPolicy('POLZ'))).status).toBe(403);
    expect((await request(app).get('/api/v2/policies').set(BE)).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run** — `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/crm2_test pnpm --filter @crm2/api test -- policies.api`  → Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/modules/policies/__tests__/policies.api.test.ts
git commit -m "test(api): policies admin — create, content-bump, OCC 409, RBAC 403"
```

---

## Task 9: Frontend gate (AuthContext + App + MustAcceptPoliciesPage)

**Files:**
- Modify: `apps/web/src/lib/AuthContext.tsx`, `apps/web/src/App.tsx`
- Create: `apps/web/src/features/auth/MustAcceptPoliciesPage.tsx`

- [ ] **Step 1: Extend `AuthContext`**

Add to `AuthState`:
```typescript
  mustAcceptPolicies: boolean;
  pendingPolicies: PendingPolicy[];
  acceptPolicies: () => Promise<void>;
```
Import the type: `import type { AuthUser, LoginResponse, PendingPolicy } from '@crm2/sdk';`
Add state in `AuthProvider`:
```typescript
  const [mustAcceptPolicies, setMustAcceptPolicies] = useState(false);
  const [pendingPolicies, setPendingPolicies] = useState<PendingPolicy[]>([]);
```
In `login()`, after `setMustChangePassword(res.mustChangePassword);`:
```typescript
    setMustAcceptPolicies(res.mustAcceptPolicies);
    setPendingPolicies(res.pendingPolicies);
```
Add the action:
```typescript
  const acceptPolicies = async (): Promise<void> => {
    await api('POST', '/api/v2/auth/accept-policies', { policyIds: pendingPolicies.map((p) => p.id) });
    setPendingPolicies([]);
    setMustAcceptPolicies(false);
  };
```
In `logout()`, after `setMustChangePassword(false);`:
```typescript
    setMustAcceptPolicies(false);
    setPendingPolicies([]);
```
Add all three to the provider `value={{ … }}`.

- [ ] **Step 2: Create the gate page**

`apps/web/src/features/auth/MustAcceptPoliciesPage.tsx` (mirrors `MustChangePasswordPage` styling — design tokens, full screen, no shell):
```typescript
/**
 * Blocking policy-acceptance screen (no app shell). Shown when login returns mustAcceptPolicies.
 * The user reads each active policy and accepts all to continue; declining logs out (ADR-0042).
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '../../lib/AuthContext.js';

export function MustAcceptPoliciesPage() {
  const { pendingPolicies, acceptPolicies, logout } = useAuth();
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    try {
      await acceptPolicies();
      toast.success('Thank you — policies accepted.');
    } catch {
      toast.error('Could not record your acceptance. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface-muted p-4 text-foreground">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border border-border bg-card shadow-sm">
        <div className="border-b border-border p-6">
          <div className="text-lg font-bold tracking-tight">Please review and accept to continue</div>
          <p className="mt-1 text-sm text-muted-foreground">
            You must accept the following before using the application.
          </p>
        </div>
        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {pendingPolicies.map((p) => (
            <section key={p.id}>
              <h2 className="mb-2 text-sm font-semibold">{p.name}</h2>
              <pre className="whitespace-pre-wrap break-words font-sans text-sm text-muted-foreground">
                {p.content}
              </pre>
            </section>
          ))}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border p-4">
          <button type="button" className="btn-ghost" onClick={() => void logout()} disabled={busy}>
            Log out
          </button>
          <button type="button" className="btn" onClick={() => void accept()} disabled={busy}>
            {busy ? 'Saving…' : 'I Accept'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Insert the gate in `App.tsx`**

Add the import:
```typescript
import { MustAcceptPoliciesPage } from './features/auth/MustAcceptPoliciesPage.js';
```
Change the destructure (`:35`) and add the gate after the password gate (`:52`):
```typescript
  const { user, ready, mustChangePassword, mustAcceptPolicies } = useAuth();
```
```typescript
  if (mustChangePassword) return <MustChangePasswordPage />;
  if (mustAcceptPolicies) return <MustAcceptPoliciesPage />;
```

- [ ] **Step 4: Build the web app**

Run: `pnpm --filter @crm2/web typecheck && pnpm --filter @crm2/web build`
Expected: PASS.

- [ ] **Step 5: Browser-verify (don't stop at the build)**

Start the dev stack (web `:5273` → api `:4000`), log in as any user → the **I Accept** screen blocks the app; click **I Accept** → lands in the app; reload → not re-prompted (persisted). Log in again → no prompt. Capture a screenshot of the gate.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/AuthContext.tsx apps/web/src/App.tsx apps/web/src/features/auth/MustAcceptPoliciesPage.tsx
git commit -m "feat(web): policy-acceptance login gate (AuthContext + App gate + accept page)"
```

---

## Task 10: Policies admin screen (mirror a master-data feature)

**Files:**
- Create: `apps/web/src/features/policies/PoliciesPage.tsx`, `PolicyDialog.tsx`
- Modify: `apps/web/src/App.tsx` (route), `apps/web/src/components/Layout.tsx:44` (nav)

> Mirror `apps/web/src/features/verificationUnits/VerificationUnitsPage.tsx` + `VerificationUnitDialog.tsx`.
> Columns: Code · Name · Version (`contentVersion`) · Effective From (`formatDateTime`) · Status (`StatusChip`) · Actions (Edit · Activate/Deactivate via OCC, sending `{ version }`). The dialog edits `name`, `description`, `content` (a `<textarea className="input min-h-[16rem]">` for markdown) + sends `version` (OCC) on PUT; handle `STALE_UPDATE` with `ConflictDialog` exactly as the reference. Query key `'policies'`, `fetchPage` → `GET /api/v2/policies?…`, no export/import wiring needed.

- [ ] **Step 1: Create `PoliciesPage.tsx` + `PolicyDialog.tsx`** following the reference deltas above.

- [ ] **Step 2: Route it** in `App.tsx` (with the other `/admin/*` routes):
```typescript
import { PoliciesPage } from './features/policies/PoliciesPage.js';
// …
        <Route path="/admin/policies" element={<PoliciesPage />} />
```

- [ ] **Step 3: Add the nav entry** in `Layout.tsx` `ADMINISTRATION` array:
```typescript
  { label: 'Policies', to: '/admin/policies', perm: 'page.policies' },
```

- [ ] **Step 4: Build + browser-verify**

Run: `pnpm --filter @crm2/web typecheck && pnpm --filter @crm2/web build`
Browser: as SUPER_ADMIN open **Administration → Policies** → list shows the seeded policy; create a second policy; edit its content → reload, log in as another user → re-prompted (content bump works end-to-end). Screenshot the admin list.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/policies apps/web/src/App.tsx apps/web/src/components/Layout.tsx
git commit -m "feat(web): policies admin screen (DataGrid list + markdown editor dialog + nav)"
```

---

## Task 11: Governance docs (ADR-0042, registry, matrix, index)

**Files:**
- Create: `docs/adr/ADR-0042-login-policy-acceptance.md` (use `docs/adr/_template.md`; Status: Accepted)
- Modify: `docs/FROZEN_DECISIONS_REGISTRY.md` (add row 35), `docs/engineering/MOBILE_API_COMPATIBILITY_MATRIX.md`, `PROJECT_INDEX.md`

- [ ] **Step 1: Write ADR-0042** — context (v1 parity, server-driven > FE-only), decision (admin-managed versioned policies, all-users gate, login+refresh enforcement, two-version model), consequences, alternatives (static-in-code rejected). Link the spec.

- [ ] **Step 2: Add FROZEN_DECISIONS_REGISTRY row 35** — "Login policy acceptance — admin-managed, versioned, all-users server-driven gate (ADR-0042)", Status LOCKED.

- [ ] **Step 3: Add the mobile-compat entry** — `POST /api/v2/auth/accept-policies` + `pendingPolicies`/`mustAcceptPolicies` on login are a locked mobile contract; `source='MOBILE'` reserved; the mobile client lands with the deferred `/api/mobile`→`/api/v2` rebase.

- [ ] **Step 4: Link from PROJECT_INDEX** — under §6 Security/compliance, add ADR-0042 + the spec.

- [ ] **Step 5: Commit**

```bash
git add docs/adr/ADR-0042-login-policy-acceptance.md docs/FROZEN_DECISIONS_REGISTRY.md docs/engineering/MOBILE_API_COMPATIBILITY_MATRIX.md PROJECT_INDEX.md
git commit -m "docs(adr): ADR-0042 login policy acceptance + registry row 35 + mobile-compat entry"
```

---

## Task 12: Full verify + finalize

- [ ] **Step 1: Run the full gate**

Run: `DATABASE_URL=postgresql://postgres@127.0.0.1:5433/crm2_test pnpm verify`
Expected: typecheck → lint → format → no-suppressions → boundaries → test → build all GREEN. Fix anything red before proceeding (do NOT `--no-verify`).

- [ ] **Step 2: Coverage check** — confirm the new modules meet the enforced floors; add tests if a floor regresses (floors ratchet up only).

- [ ] **Step 3: Update the open-items register** — in `docs/operations/OPEN_ITEMS_2026-06-17.md` (and the compliance registry if appropriate), note the policy-acceptance feature shipped; if mobile-client wiring remains, record it as a deferred item under the mobile rebase.

- [ ] **Step 4: Final commit (if step 3 changed docs)**

```bash
git add docs/operations/OPEN_ITEMS_2026-06-17.md
git commit -m "docs(ops): record login-policy-acceptance shipped; mobile client deferred"
```

- [ ] **Step 5: STOP — do not push.** Report green `pnpm verify` + the two browser screenshots and ask for explicit OK before any push (push auto-deploys).

---

## Self-review (done before handoff)
- **Spec coverage:** data model (T1), permissions (T2), SDK (T3), gate repo/service/controller/route (T4–5), gate tests (T6), admin module+tests (T7–8), FE gate (T9), FE admin (T10), ADR/registry/matrix (T11), verify (T12). All §2–§9 spec items mapped. ✔
- **Acceptance criteria** §8: AC1 gate-blocks (T6/T9), AC2 immutable+idempotent (T6), AC3 content-bump re-accept (T6/T8), AC4 deactivate removes from gate (covered by the `is_active` predicate; spot-checked in T10 browser), AC5 OCC 409 (T8), AC6 RBAC 403 + self-only accept (T6/T8). ✔
- **Type consistency:** `mustAcceptPolicies`/`pendingPolicies`/`PendingPolicy`/`contentVersion`/`acceptPolicies()` names match across SDK, service, controller, AuthContext, App, page. ✔
- **No placeholders:** the only deferred literal is the policy text body (T1 step 1) — sourced verbatim from the named v1 file, not invented.
