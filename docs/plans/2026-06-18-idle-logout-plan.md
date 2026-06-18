# Idle / inactivity auto-logout (web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a server-driven, role-aware warn-then-logout idle timeout (DESK roles only; FIELD_AGENT exempt) plus a server-enforced 12 h absolute session cap to the v2 web app.

**Architecture:** Idle is FE-driven (port of v1 `sessionManager`) with thresholds the server decides (`roles.idle_logout_minutes`; `null` ⇒ the manager never starts). The 12 h cap is truly server-enforced via `auth_refresh_tokens.absolute_expires_at`, which rotation never extends, so the existing `expires_at > now()` refresh check rejects past-cap refreshes. Cross-tab via `localStorage`; cross-device admin force-logout via the existing `auth:session_revoked` realtime emit (lit up for web by synthesizing a per-browser `deviceId`). Idle/absolute timeout revokes **only this browser session** (not logout-everywhere).

**Tech Stack:** Postgres (db/v2 migrations), Express + Zod + supertest (apps/api), React + TanStack Query + Tailwind (apps/web), Vitest, Playwright (`page.clock`), `@crm2/sdk`, `@crm2/logger`.

**Source spec:** `docs/specs/2026-06-18-idle-logout-design.md`

**Pre-flight (run once before Task 1):**
```bash
cd /Users/mayurkulkarni/Downloads/crm2/.claude/worktrees/feat+idle-logout
pnpm install   # fresh worktree has no node_modules — REQUIRED before any test/verify
```
Integration tests need `DATABASE_URL` (ephemeral PG on :5433, `LC_ALL=C`); they `describe.skipIf(!RUN)` without it.

**Two semantics locked by the CTO (confirm at plan review):**
1. Idle/absolute timeout → `auth.revokeSession(currentJti)` (this browser only). A web tab idling out must NOT kill the user's mobile session. Manual logout / change-password keep logout-everywhere.
2. Web login synthesizes a stable per-browser `deviceId` (`acs.deviceId`) so the existing device-gated `auth:session_revoked` emit reaches web tabs.

---

## Phase 1 — Backend data model + contract

### Task 1: Migration 0074 — role columns + refresh-token absolute cap

**Files:**
- Create: `db/v2/migrations/0074_idle_logout_and_session_cap.sql`
- Test: add to `apps/api/src/modules/auth/__tests__/auth.api.test.ts`

- [ ] **Step 1: Write the migration**

```sql
-- 0074_idle_logout_and_session_cap.sql — web idle auto-logout + absolute session cap (ADR-0045).
-- roles.idle_logout_minutes: warn-then-logout window for DESK web users; NULL = exempt (FIELD_AGENT).
-- roles.max_session_minutes: absolute session lifetime regardless of activity; NULL = no cap.
-- auth_refresh_tokens.absolute_expires_at: hard session deadline set at login, never extended by
-- rotation — the existing `expires_at > now()` refresh check enforces it. Forward-only, idempotent.

ALTER TABLE roles ADD COLUMN IF NOT EXISTS idle_logout_minutes integer;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS max_session_minutes integer;
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS absolute_expires_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_roles_idle_logout_minutes') THEN
    ALTER TABLE roles ADD CONSTRAINT chk_roles_idle_logout_minutes
      CHECK (idle_logout_minutes IS NULL OR (idle_logout_minutes >= 1 AND idle_logout_minutes <= 1440));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_roles_max_session_minutes') THEN
    ALTER TABLE roles ADD CONSTRAINT chk_roles_max_session_minutes
      CHECK (max_session_minutes IS NULL OR (max_session_minutes >= 5 AND max_session_minutes <= 10080));
  END IF;
END $$;

-- Default policy: DESK roles + SUPER_ADMIN get 10-min idle + 12h (720-min) absolute cap; FIELD_AGENT
-- stays exempt (NULL). Guarded by `IS NULL` so a re-run never clobbers an admin's later per-role change.
UPDATE roles SET idle_logout_minutes = 10
  WHERE code IN ('SUPER_ADMIN', 'MANAGER', 'TEAM_LEADER', 'BACKEND_USER', 'KYC_VERIFIER')
    AND idle_logout_minutes IS NULL;
UPDATE roles SET max_session_minutes = 720
  WHERE code IN ('SUPER_ADMIN', 'MANAGER', 'TEAM_LEADER', 'BACKEND_USER', 'KYC_VERIFIER')
    AND max_session_minutes IS NULL;
```

- [ ] **Step 2: Write the failing test** (append inside `describe.skipIf(!RUN)('auth API', …)` in `auth.api.test.ts`)

```typescript
it('migration 0074 seeds idle + session-cap policy (DESK set, FIELD_AGENT exempt)', async () => {
  const desk = await db!.pool.query(
    `SELECT idle_logout_minutes, max_session_minutes FROM roles WHERE code = 'MANAGER'`,
  );
  expect(desk.rows[0]).toEqual({ idle_logout_minutes: 10, max_session_minutes: 720 });
  const field = await db!.pool.query(
    `SELECT idle_logout_minutes, max_session_minutes FROM roles WHERE code = 'FIELD_AGENT'`,
  );
  expect(field.rows[0]).toEqual({ idle_logout_minutes: null, max_session_minutes: null });
});
```

- [ ] **Step 3: Run** — `DATABASE_URL=… LC_ALL=C pnpm --filter @crm2/api test -- auth.api` — Expected: PASS (template DB rebuilds with the new migration).

- [ ] **Step 4: Commit**
```bash
git add db/v2/migrations/0074_idle_logout_and_session_cap.sql apps/api/src/modules/auth/__tests__/auth.api.test.ts
git commit --author="Mayur Kulkarni <mayurkulkarni786@gmail.com>" -m "feat(db): migration 0074 — role idle-logout + 12h session cap columns"
```

---

### Task 2: Role attribute loader carries the two new columns

**Files:**
- Modify: `apps/api/src/platform/access/repository.ts:11-17` (interface) and `:20-40` (SELECT)

- [ ] **Step 1: Extend `RoleAttributes`** (after `passwordExpiryDays: number | null;`)
```typescript
export interface RoleAttributes {
  grantsAll: boolean;
  permissions: string[];
  hierarchyMode: HierarchyMode;
  /** force a password change every N days for users of this role; null = never (exempt). */
  passwordExpiryDays: number | null;
  /** web idle auto-logout window in minutes (ADR-0045); null = exempt (FIELD_AGENT). */
  idleLogoutMinutes: number | null;
  /** absolute session lifetime in minutes (ADR-0045); null = no cap. */
  maxSessionMinutes: number | null;
}
```

- [ ] **Step 2: Extend the `loadRoleAttributes` SELECT + mapping** — change the typed query and `base`:
```typescript
  const roles = await query<{
    grantsAll: boolean;
    hierarchyMode: HierarchyMode;
    passwordExpiryDays: number | null;
    idleLogoutMinutes: number | null;
    maxSessionMinutes: number | null;
  }>(
    `SELECT grants_all AS "grantsAll", hierarchy_mode AS "hierarchyMode",
            password_expiry_days AS "passwordExpiryDays",
            idle_logout_minutes AS "idleLogoutMinutes",
            max_session_minutes AS "maxSessionMinutes"
     FROM roles WHERE code = $1 AND is_active`,
    [roleCode],
  );
  const role = roles[0];
  if (!role) return null;
  const base = {
    hierarchyMode: role.hierarchyMode,
    passwordExpiryDays: role.passwordExpiryDays,
    idleLogoutMinutes: role.idleLogoutMinutes,
    maxSessionMinutes: role.maxSessionMinutes,
  };
```
(The two `return` statements already spread `...base`, so both branches carry the new fields. `getRoleAttributes` cache is unchanged.)

- [ ] **Step 3: Typecheck** — `pnpm --filter @crm2/api typecheck` (or `pnpm -w typecheck`) — Expected: PASS. (Behavior verified via Task 4's login test.)

- [ ] **Step 4: Commit**
```bash
git add apps/api/src/platform/access/repository.ts
git commit --author="Mayur Kulkarni <mayurkulkarni786@gmail.com>" -m "feat(api): load idle-logout + session-cap role attributes"
```

---

### Task 3: SDK contract — `AuthUser` gains the two fields

**Files:**
- Modify: `packages/sdk/src/auth.ts:28-39`

- [ ] **Step 1: Add fields to `AuthUser`** (after `permissions?: string[];`)
```typescript
  /** web idle auto-logout window in minutes (ADR-0045); null ⇒ this role is exempt (no FE timer). */
  idleLogoutMinutes?: number | null;
  /** absolute session lifetime in minutes (ADR-0045); null ⇒ no cap. */
  maxSessionMinutes?: number | null;
```
(Optional `?` keeps backward-compat for any caller building an `AuthUser` literal.)

- [ ] **Step 2: Build the SDK** — `pnpm --filter @crm2/sdk build` — Expected: PASS.

- [ ] **Step 3: Commit**
```bash
git add packages/sdk/src/auth.ts
git commit --author="Mayur Kulkarni <mayurkulkarni786@gmail.com>" -m "feat(sdk): AuthUser carries idleLogoutMinutes + maxSessionMinutes"
```

---

### Task 4: `withResolvedPermissions` surfaces the fields on login + /me

**Files:**
- Modify: `apps/api/src/modules/auth/service.ts:126-131`
- Test: `apps/api/src/modules/auth/__tests__/auth.api.test.ts`

- [ ] **Step 1: Write the failing test**
```typescript
it('login response carries the role idle + session-cap policy (DESK)', async () => {
  await makeUser({ username: 'mgr', role: 'MANAGER' });
  const res = await login('mgr');
  expect(res.body.user.idleLogoutMinutes).toBe(10);
  expect(res.body.user.maxSessionMinutes).toBe(720);
});
it('login response marks FIELD_AGENT exempt (null idle policy)', async () => {
  await makeUser({ username: 'fa', role: 'FIELD_AGENT' });
  const res = await login('fa');
  expect(res.body.user.idleLogoutMinutes).toBeNull();
  expect(res.body.user.maxSessionMinutes).toBeNull();
});
```

- [ ] **Step 2: Run** — Expected: FAIL (fields `undefined`).

- [ ] **Step 3: Update `withResolvedPermissions`**
```typescript
async function withResolvedPermissions<T extends { role: string }>(
  user: T,
): Promise<
  T & {
    grantsAll: boolean;
    permissions: string[];
    idleLogoutMinutes: number | null;
    maxSessionMinutes: number | null;
  }
> {
  const attrs = await getRoleAttributes(user.role);
  return {
    ...user,
    grantsAll: attrs?.grantsAll ?? false,
    permissions: attrs?.permissions ?? [],
    idleLogoutMinutes: attrs?.idleLogoutMinutes ?? null,
    maxSessionMinutes: attrs?.maxSessionMinutes ?? null,
  };
}
```

- [ ] **Step 4: Run** — Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add apps/api/src/modules/auth/service.ts apps/api/src/modules/auth/__tests__/auth.api.test.ts
git commit --author="Mayur Kulkarni <mayurkulkarni786@gmail.com>" -m "feat(api): surface idle/session-cap policy on login + /auth/me"
```

---

## Phase 2 — Absolute session cap (server-enforced)

### Task 5: Issue refresh tokens with `absolute_expires_at` at login

**Files:**
- Modify: `apps/api/src/modules/auth/repository.ts` (`RefreshRow` ~29-36, `insertRefresh` ~167-181, `findRefresh` ~183-190)
- Modify: `apps/api/src/modules/auth/service.ts` (`issueTokens` 99-122, `login` 148-159)
- Test: `auth.api.test.ts`

- [ ] **Step 1: Extend `RefreshRow` + `findRefresh` SELECT** (add `absoluteExpiresAt`)
```typescript
interface RefreshRow {
  userId: string;
  expiresAt: string;
  revokedAt: string | null;
  deviceId: string | null;
  deviceInfo: string | null;
  absoluteExpiresAt: string | null;
}
```
```typescript
  const rows = await query<RefreshRow>(
    `SELECT user_id AS "userId", expires_at AS "expiresAt", revoked_at AS "revokedAt",
            device_id AS "deviceId", device_info AS "deviceInfo",
            absolute_expires_at AS "absoluteExpiresAt"
     FROM auth_refresh_tokens WHERE jti = $1`,
    [jti],
  );
```
> NOTE: confirm whether `findRefresh`/`RefreshRow` already alias columns or rely on a global snake→camel mapper. If a mapper exists, only add `absolute_expires_at` to the SELECT and the field to the interface; keep the file's existing aliasing style.

- [ ] **Step 2: Extend `insertRefresh`** (add `absoluteExpiresAt` param + column)
```typescript
async insertRefresh(input: {
  jti: string;
  userId: string;
  expiresAt: Date;
  deviceId: string | null;
  deviceInfo: string | null;
  ip: string | null;
  absoluteExpiresAt: Date | null;
}): Promise<void> {
  await query(
    `INSERT INTO auth_refresh_tokens (jti, user_id, expires_at, device_id, device_info, ip, absolute_expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [input.jti, input.userId, input.expiresAt, input.deviceId, input.deviceInfo, input.ip, input.absoluteExpiresAt],
  );
}
```

- [ ] **Step 3: Thread the deadline through `issueTokens`** (new last param + `least()` in TS)
```typescript
async function issueTokens(
  userId: string,
  role: string,
  device: Device,
  ip: string | null,
  absoluteExpiresAt: Date | null,
): Promise<AuthTokens> {
  const env = loadEnv();
  const accessTtl = env.AUTH_ACCESS_TTL_S;
  const refreshTtl = env.AUTH_REFRESH_TTL_S;
  const jti = randomUUID();
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken({ userId, role }, accessTtl),
    signRefreshToken({ userId, jti }, refreshTtl),
  ]);
  const refreshExpiresAt = new Date(Date.now() + refreshTtl * MS_PER_S);
  // the absolute cap (if any) never moves out on rotation → expires_at is the earlier of the two.
  const expiresAt =
    absoluteExpiresAt && absoluteExpiresAt.getTime() < refreshExpiresAt.getTime()
      ? absoluteExpiresAt
      : refreshExpiresAt;
  await repo.insertRefresh({
    jti,
    userId,
    expiresAt,
    deviceId: device.deviceId,
    deviceInfo: device.deviceInfo,
    ip,
    absoluteExpiresAt,
  });
  return { accessToken, refreshToken, expiresIn: accessTtl };
}
```

- [ ] **Step 4: Wire `login`** — move the `attrs` fetch ABOVE `issueTokens`, compute the deadline, drop the duplicate fetch at old line 158:
```typescript
    await repo.resetLoginState(creds.id); // success clears the failed-attempt counter
    const attrs = await getRoleAttributes(creds.role);
    const absoluteExpiresAt =
      attrs?.maxSessionMinutes != null ? new Date(Date.now() + attrs.maxSessionMinutes * 60_000) : null;
    const tokens = await issueTokens(
      creds.id,
      creds.role,
      { deviceId: v.deviceId ?? null, deviceInfo: v.deviceInfo ?? null },
      ip,
      absoluteExpiresAt,
    );
    const user = await repo.authUserById(creds.id);
    if (!user) throw AppError.internal('user vanished mid-login');
    const expired = passwordExpired(creds.passwordSetAt, attrs?.passwordExpiryDays ?? null);
```
(Delete the now-duplicate `const attrs = await getRoleAttributes(creds.role);` that previously sat just above the `expired` line.)

- [ ] **Step 5: Write the failing test**
```typescript
it('DESK login stamps a 12h absolute deadline on the refresh token', async () => {
  await makeUser({ username: 'mgr2', role: 'MANAGER' });
  await login('mgr2');
  const r = await db!.pool.query(
    `SELECT absolute_expires_at, expires_at FROM auth_refresh_tokens
     WHERE user_id = (SELECT id FROM users WHERE username = 'mgr2')`,
  );
  const abs = new Date(r.rows[0].absolute_expires_at as string).getTime();
  const expectedMin = Date.now() + 718 * 60_000;
  const expectedMax = Date.now() + 722 * 60_000;
  expect(abs).toBeGreaterThan(expectedMin);
  expect(abs).toBeLessThan(expectedMax);
});
it('FIELD_AGENT login leaves absolute_expires_at NULL (no cap)', async () => {
  await makeUser({ username: 'fa2', role: 'FIELD_AGENT' });
  await login('fa2');
  const r = await db!.pool.query(
    `SELECT absolute_expires_at FROM auth_refresh_tokens
     WHERE user_id = (SELECT id FROM users WHERE username = 'fa2')`,
  );
  expect(r.rows[0].absolute_expires_at).toBeNull();
});
```

- [ ] **Step 6: Run** — Expected: PASS. **Commit**
```bash
git add apps/api/src/modules/auth/repository.ts apps/api/src/modules/auth/service.ts apps/api/src/modules/auth/__tests__/auth.api.test.ts
git commit --author="Mayur Kulkarni <mayurkulkarni786@gmail.com>" -m "feat(api): stamp absolute session deadline on login refresh token"
```

---

### Task 6: Refresh carries the cap forward and rejects past it

**Files:**
- Modify: `apps/api/src/modules/auth/service.ts` (`refresh` 221-245)
- Test: `auth.api.test.ts`

- [ ] **Step 1: Update the rotation call** — pass the parent's deadline forward:
```typescript
    await repo.revokeRefresh(claims.jti);
    return issueTokens(
      claims.userId,
      status.role,
      { deviceId: row.deviceId, deviceInfo: row.deviceInfo },
      ip,
      row.absoluteExpiresAt ? new Date(row.absoluteExpiresAt) : null,
    );
```
(No change to the validity check at line 226 — it already rejects `expiresAt < now`, which is the cap's enforcement vector.)

- [ ] **Step 2: Write the failing tests**
```typescript
it('refresh carries the absolute deadline forward unchanged (never extends it)', async () => {
  await makeUser({ username: 'mgr3', role: 'MANAGER' });
  const res = await login('mgr3');
  const before = await db!.pool.query(
    `SELECT absolute_expires_at FROM auth_refresh_tokens
     WHERE user_id = (SELECT id FROM users WHERE username = 'mgr3') AND revoked_at IS NULL`,
  );
  const r2 = await request(app)
    .post('/api/v2/auth/refresh')
    .send({ refreshToken: res.body.tokens.refreshToken });
  expect(r2.status).toBe(200);
  const after = await db!.pool.query(
    `SELECT absolute_expires_at FROM auth_refresh_tokens
     WHERE user_id = (SELECT id FROM users WHERE username = 'mgr3') AND revoked_at IS NULL`,
  );
  expect(new Date(after.rows[0].absolute_expires_at as string).getTime()).toBe(
    new Date(before.rows[0].absolute_expires_at as string).getTime(),
  );
});
it('refresh is rejected once the absolute deadline has passed', async () => {
  await makeUser({ username: 'mgr4', role: 'MANAGER' });
  const res = await login('mgr4');
  // simulate the 12h cap elapsing: push expires_at into the past (cap sets expires_at = deadline)
  await db!.pool.query(
    `UPDATE auth_refresh_tokens SET expires_at = now() - interval '1 second'
     WHERE user_id = (SELECT id FROM users WHERE username = 'mgr4') AND revoked_at IS NULL`,
  );
  const r2 = await request(app)
    .post('/api/v2/auth/refresh')
    .send({ refreshToken: res.body.tokens.refreshToken });
  expect(r2.status).toBe(401);
  expect(r2.body.error).toBe('INVALID_REFRESH');
});
```

- [ ] **Step 3: Run** — Expected: PASS. **Commit**
```bash
git add apps/api/src/modules/auth/service.ts apps/api/src/modules/auth/__tests__/auth.api.test.ts
git commit --author="Mayur Kulkarni <mayurkulkarni786@gmail.com>" -m "feat(api): carry session cap across refresh rotation + enforce on expiry"
```

---

## Phase 3 — Roles admin config (so SUPER_ADMIN can tune per role)

### Task 7: Thread both fields through the roles config (SDK + repo + service)

**Files:**
- Modify: `packages/sdk/src/roles.ts` (`RoleView` ~41, validators ~69, Create ~81, Update ~93)
- Modify: `apps/api/src/modules/roles/repository.ts` (`COLS` 10, `RoleRow` ~32, `UpdateRoleRow` ~43, create INSERT ~178/187, `updateConfig` SET 232 + params 243, `findView` mapping)
- Modify: `apps/api/src/modules/roles/service.ts` (`update` 193-214, and the create path symmetrically)
- Test: the roles API test (e.g. `apps/api/src/modules/roles/__tests__/roles.api.test.ts` — follow its existing pattern)

- [ ] **Step 1: SDK types/validators** (`packages/sdk/src/roles.ts`)
  - Add to `RoleView` (after `passwordExpiryDays: number | null;`):
    ```typescript
    idleLogoutMinutes: number | null;
    maxSessionMinutes: number | null;
    ```
  - Add validators near `passwordExpiryDays` (line 69):
    ```typescript
    const idleLogoutMinutes = z.number().int().min(1).max(1440).nullable();
    const maxSessionMinutes = z.number().int().min(5).max(10080).nullable();
    ```
  - Add to BOTH `CreateRoleSchema` (~81) and `UpdateRoleSchema` (~93), alongside `passwordExpiryDays`:
    ```typescript
    idleLogoutMinutes: idleLogoutMinutes.optional(),
    maxSessionMinutes: maxSessionMinutes.optional(),
    ```

- [ ] **Step 2: Repository** (`apps/api/src/modules/roles/repository.ts`)
  - `COLS` (line 10): add `idle_logout_minutes, max_session_minutes` before `version`.
  - `RoleRow` (~32) + `UpdateRoleRow` (~43): add `idleLogoutMinutes: number | null;` and `maxSessionMinutes: number | null;` (Update variant uses `| undefined` like `passwordExpiryDays`).
  - Create INSERT (~178/187): add the two columns to the column list + values, mapping `input.idleLogoutMinutes`, `input.maxSessionMinutes`.
  - `updateConfig` (232): extend the SET clause — append `idle_logout_minutes = $9, max_session_minutes = $10,` (renumber the existing `version = version + 1 …` placeholders accordingly; current uses $1–$8, so the new params become $9/$10 and the WHERE `version = $7` stays as-is since params are positional — re-verify numbering when editing). Add to the params array, mirroring the `passwordExpiryDays` `=== undefined ? before.x : input.x` guard.
  - `findView` mapping: select aliases `idle_logout_minutes AS "idleLogoutMinutes"`, `max_session_minutes AS "maxSessionMinutes"` so `RoleView` is populated (follow how `passwordExpiryDays` is mapped in `findView`/`RoleRow`→`RoleView`).

- [ ] **Step 3: Service** (`apps/api/src/modules/roles/service.ts`) — in `update()` (and the create function), pass the two fields into `repo.updateConfig`/create input alongside `passwordExpiryDays: v.passwordExpiryDays`:
```typescript
      passwordExpiryDays: v.passwordExpiryDays,
      idleLogoutMinutes: v.idleLogoutMinutes,
      maxSessionMinutes: v.maxSessionMinutes,
```

- [ ] **Step 4: Write the failing test** (roles API test, SUPER_ADMIN auth header `SA`)
```typescript
it('admin can edit a role idle-logout + session-cap policy (OCC)', async () => {
  const view = (await request(app).get('/api/v2/roles/MANAGER').set(SA)).body;
  const res = await request(app)
    .put('/api/v2/roles/MANAGER')
    .set(SA)
    .send({ name: view.name, hierarchyMode: view.hierarchyMode, idleLogoutMinutes: 15, version: view.version });
  expect(res.status).toBe(200);
  const after = (await request(app).get('/api/v2/roles/MANAGER').set(SA)).body;
  expect(after.idleLogoutMinutes).toBe(15);
});
```

- [ ] **Step 5: Run** — `pnpm --filter @crm2/sdk build && DATABASE_URL=… LC_ALL=C pnpm --filter @crm2/api test -- roles` — Expected: PASS. **Commit**
```bash
git add packages/sdk/src/roles.ts apps/api/src/modules/roles/ apps/api/src/modules/roles/__tests__/
git commit --author="Mayur Kulkarni <mayurkulkarni786@gmail.com>" -m "feat(api): roles admin config for idle-logout + session cap (OCC)"
```

---

### Task 8: Roles admin UI — two number fields + grid columns

**Files:**
- Modify: `apps/web/src/features/access/RolesPage.tsx` (state ~259-271, mutation body ~289-307, grid columns ~92-99, dialog fields ~406-422)

- [ ] **Step 1: Add state in `RoleDialog`** (next to `pwExpiry`)
```typescript
const [idleLogout, setIdleLogout] = useState(
  row ? (row.idleLogoutMinutes != null ? String(row.idleLogoutMinutes) : '') : '10',
);
const [maxSession, setMaxSession] = useState(
  row ? (row.maxSessionMinutes != null ? String(row.maxSessionMinutes) : '') : '720',
);
```

- [ ] **Step 2: Add fields to the mutation body** (next to `passwordExpiryDays`)
```typescript
      idleLogoutMinutes: idleLogout.trim() === '' ? null : Number(idleLogout),
      maxSessionMinutes: maxSession.trim() === '' ? null : Number(maxSession),
```

- [ ] **Step 3: Render two inputs** after the password-expiry `<label>` block (mirror its markup, `type="number"`, helper text "Leave blank to exempt (field agents)." for idle, "Leave blank for no cap." for max). Use `min={1} max={1440}` (idle) and `min={5} max={10080}` (max).

- [ ] **Step 4: Add two DataGrid columns** mirroring the `passwordExpiryDays` column (id `idleLogoutMinutes` → `${r.idleLogoutMinutes} min` / `Exempt`; id `maxSessionMinutes` → `${r.maxSessionMinutes} min` / `No cap`).

- [ ] **Step 5: Typecheck + browser-verify** — `pnpm --filter @crm2/web typecheck`. Then (per `feedback_browser_verify_perform_actions`) open `/access/roles` in the preview, edit MANAGER's idle value, save, confirm it persists on reload. **Commit**
```bash
git add apps/web/src/features/access/RolesPage.tsx
git commit --author="Mayur Kulkarni <mayurkulkarni786@gmail.com>" -m "feat(web): roles admin UI for idle-logout + session-cap policy"
```

---

## Phase 4 — Frontend session manager + modal + wiring

### Task 9: In-flight mutation counter in the API wrapper

**Files:**
- Modify: `apps/web/src/lib/sdk.ts`
- Test: Create `apps/web/src/lib/sdk.test.ts`

- [ ] **Step 1: Write the failing test**
```typescript
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, hasActiveMutations } from './sdk.js';

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('acs.accessToken', 'tok');
});
afterEach(() => vi.restoreAllMocks());

it('counts an in-flight POST as an active mutation, clears after it settles', async () => {
  let resolveFetch: (v: Response) => void = () => {};
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => (resolveFetch = r))));
  const p = api('POST', '/x', { a: 1 });
  expect(hasActiveMutations()).toBe(true);
  resolveFetch(new Response('{}', { status: 200 }));
  await p;
  expect(hasActiveMutations()).toBe(false);
});

it('does NOT count a background GET', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  const p = api('GET', '/x');
  expect(hasActiveMutations()).toBe(false);
  await p;
});
```

- [ ] **Step 2: Run** — `pnpm --filter @crm2/web test -- sdk` — Expected: FAIL (`hasActiveMutations` not exported).

- [ ] **Step 3: Implement** — add after the `ApiError` class:
```typescript
/**
 * Idle-logout pause signal (ADR-0045): number of in-flight user-initiated mutations (non-GET) and
 * uploads. The session manager skips its idle tick while this is > 0 so a long save/upload never
 * times out. Background GET refetches are deliberately NOT counted (a noisy tab can't defeat idle).
 */
let activeMutations = 0;
export function hasActiveMutations(): boolean {
  return activeMutations > 0;
}
```
In `api()`, wrap the body so only the top-level (non-retry) non-GET call is counted, and the retry recursion is awaited so the decrement fires after it:
```typescript
export async function api<T>(method: string, path: string, body?: unknown, retry = false): Promise<T> {
  const tracked = !retry && method.toUpperCase() !== 'GET';
  if (tracked) activeMutations += 1;
  try {
    const accessToken = tokenStore.access();
    const init: RequestInit = {
      method,
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(path, init);
    if (res.status === HTTP_UNAUTHORIZED && !retry && tokenStore.refresh()) {
      if (await refreshOnce()) return await api<T>(method, path, body, true);
      tokenStore.clear();
      onUnauthorized();
      throw new Error('UNAUTHENTICATED');
    }
    const text = await res.text();
    const json = text ? JSON.parse(text) : null;
    if (!res.ok) throw new ApiError(res.status, json?.error ?? `HTTP ${res.status}`, json);
    return json as T;
  } finally {
    if (tracked) activeMutations -= 1;
  }
}
```
Apply the same `tracked = !retry` try/finally + `return await apiUpload(...)` change to `apiUpload()`.

- [ ] **Step 4: Run** — Expected: PASS. **Commit**
```bash
git add apps/web/src/lib/sdk.ts apps/web/src/lib/sdk.test.ts
git commit --author="Mayur Kulkarni <mayurkulkarni786@gmail.com>" -m "feat(web): expose hasActiveMutations to pause idle timer during saves"
```

---

### Task 10: Device id + session-start helpers in the token store

**Files:**
- Modify: `apps/web/src/lib/auth.ts`

- [ ] **Step 1: Add to `tokenStore`** (and constants)
```typescript
const DEVICE_KEY = 'acs.deviceId';
const SESSION_STARTED_KEY = 'acs.sessionStartedAt';
```
```typescript
  /** stable per-browser device id so server-side session revoke (auth:session_revoked) reaches web. */
  deviceId(): string {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = `web-${crypto.randomUUID()}`;
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  },
  /** wall-clock anchor for the absolute session cap; set at login, read by the session manager. */
  markSessionStart(): void {
    localStorage.setItem(SESSION_STARTED_KEY, String(Date.now()));
  },
  clearSessionStart(): void {
    localStorage.removeItem(SESSION_STARTED_KEY);
  },
```
(Do NOT clear `acs.deviceId` on logout — it identifies the browser across sessions.)

- [ ] **Step 2: Typecheck** — `pnpm --filter @crm2/web typecheck` — Expected: PASS. **Commit**
```bash
git add apps/web/src/lib/auth.ts
git commit --author="Mayur Kulkarni <mayurkulkarni786@gmail.com>" -m "feat(web): per-browser device id + session-start anchor in token store"
```

---

### Task 11: `sessionManager` (native port, no deps)

**Files:**
- Create: `apps/web/src/lib/sessionManager.ts`
- Test: Create `apps/web/src/lib/sessionManager.test.ts`

- [ ] **Step 1: Write the manager**
```typescript
import { logger } from '@crm2/logger';
import { tokenStore } from './auth.js';
import { hasActiveMutations } from './sdk.js';

const WARN_BEFORE_LOGOUT_S = 60;
const CHECK_INTERVAL_VISIBLE = 1000;
const CHECK_INTERVAL_HIDDEN = 30_000;
const ACTIVITY_THROTTLE_MS = 1000;
const LAST_ACTIVITY_KEY = 'acs.lastActivity';
const FORCE_LOGOUT_KEY = 'acs.forceLogout';
const SESSION_STARTED_KEY = 'acs.sessionStartedAt';
const ACTIVITY_EVENTS = [
  'mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'click', 'visibilitychange',
] as const;

export interface IdleConfig {
  idleLogoutMinutes: number | null;
  maxSessionMinutes: number | null;
}
export interface IdleCallbacks {
  onWarning: (remainingSeconds: number) => void;
  onClearWarning: () => void;
  onLogout: (reason: string) => void;
}

class SessionManager {
  private idleMs = Number.POSITIVE_INFINITY;
  private warnMs = Number.POSITIVE_INFINITY;
  private maxSessionMs: number | null = null;
  private lastActivity = Date.now();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private warned = false;
  private started = false;
  private cb: IdleCallbacks | null = null;

  init(config: IdleConfig, cb: IdleCallbacks): void {
    if (this.started) return;
    if (config.idleLogoutMinutes == null && config.maxSessionMinutes == null) return; // exempt role
    if (config.idleLogoutMinutes != null) {
      this.idleMs = config.idleLogoutMinutes * 60_000;
      this.warnMs = Math.max(0, this.idleMs - WARN_BEFORE_LOGOUT_S * 1000);
    }
    this.maxSessionMs = config.maxSessionMinutes != null ? config.maxSessionMinutes * 60_000 : null;
    this.cb = cb;
    this.started = true;
    this.lastActivity = this.readStoredActivity() ?? Date.now();
    this.updateActivity();
    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, this.onActivity, { passive: true }));
    window.addEventListener('storage', this.onStorage);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.startPolling();
  }

  destroy(): void {
    if (!this.started) return;
    this.stopPolling();
    ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, this.onActivity));
    window.removeEventListener('storage', this.onStorage);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.cb = null;
    this.started = false;
    this.warned = false;
    this.idleMs = Number.POSITIVE_INFINITY;
    this.warnMs = Number.POSITIVE_INFINITY;
    this.maxSessionMs = null;
  }

  /** "Stay Logged In" — reset the idle clock and dismiss the warning. */
  extend(): void {
    this.warned = false;
    this.updateActivity();
    logger.info('idle_extended');
    this.cb?.onClearWarning();
  }

  private readStoredActivity(): number | null {
    const v = localStorage.getItem(LAST_ACTIVITY_KEY);
    return v ? parseInt(v, 10) : null;
  }
  private updateActivity(): void {
    this.lastActivity = Date.now();
    localStorage.setItem(LAST_ACTIVITY_KEY, String(this.lastActivity));
  }
  private clearWarningIfShown(): void {
    if (this.warned) {
      this.warned = false;
      this.cb?.onClearWarning();
    }
  }
  private onActivity = (): void => {
    if (Date.now() - this.lastActivity > ACTIVITY_THROTTLE_MS) {
      this.clearWarningIfShown();
      this.updateActivity();
    }
  };
  private onStorage = (e: StorageEvent): void => {
    if (e.key === FORCE_LOGOUT_KEY && e.newValue) {
      this.trigger('Your session has ended.');
    } else if (e.key === LAST_ACTIVITY_KEY && e.newValue) {
      const t = parseInt(e.newValue, 10);
      if (t > this.lastActivity) {
        this.lastActivity = t;
        this.clearWarningIfShown();
      }
    }
  };
  private onVisibility = (): void => {
    if (!this.intervalId) return;
    this.stopPolling();
    this.startPolling();
    this.check(); // resume-from-suspend: re-evaluate immediately, don't wait for the next tick
  };
  private startPolling(): void {
    const hidden = typeof document !== 'undefined' && document.hidden;
    this.intervalId = setInterval(this.check, hidden ? CHECK_INTERVAL_HIDDEN : CHECK_INTERVAL_VISIBLE);
  }
  private stopPolling(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private check = (): void => {
    if (!tokenStore.access()) return; // session sentinel — nothing to police
    const now = Date.now();
    if (this.maxSessionMs != null) {
      const start = parseInt(localStorage.getItem(SESSION_STARTED_KEY) ?? '0', 10);
      if (start > 0 && now - start >= this.maxSessionMs) {
        this.trigger('Your session reached its maximum length. Please sign in again.');
        return;
      }
    }
    if (hasActiveMutations()) {
      this.updateActivity(); // a save/upload is in flight — treat as active
      return;
    }
    const stored = this.readStoredActivity();
    if (stored && stored > this.lastActivity) this.lastActivity = stored;
    const idle = now - this.lastActivity;
    if (idle >= this.idleMs) {
      this.trigger('You were signed out due to inactivity.');
    } else if (idle >= this.warnMs) {
      this.warned = true;
      this.cb?.onWarning(Math.max(0, Math.ceil((this.idleMs - idle) / 1000)));
    }
  };

  private trigger(reason: string): void {
    if (!tokenStore.access()) return; // idempotent — already logged out
    localStorage.setItem(FORCE_LOGOUT_KEY, String(Date.now()));
    logger.info('idle_timeout_triggered', { reason });
    const cb = this.cb;
    this.destroy();
    cb?.onLogout(reason);
  }
}

export const sessionManager = new SessionManager();
```

- [ ] **Step 2: Write the failing tests**
```typescript
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sessionManager } from './sessionManager.js';

function makeCb() {
  return { onWarning: vi.fn(), onClearWarning: vi.fn(), onLogout: vi.fn() };
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  localStorage.setItem('acs.accessToken', 'tok');
});
afterEach(() => {
  sessionManager.destroy();
  vi.useRealTimers();
});

it('exempt role (both null) never starts the timer', () => {
  const cb = makeCb();
  sessionManager.init({ idleLogoutMinutes: null, maxSessionMinutes: null }, cb);
  vi.advanceTimersByTime(60 * 60_000);
  expect(cb.onWarning).not.toHaveBeenCalled();
  expect(cb.onLogout).not.toHaveBeenCalled();
});

it('warns 60s before the idle deadline and logs out at it', () => {
  const cb = makeCb();
  sessionManager.init({ idleLogoutMinutes: 10, maxSessionMinutes: null }, cb);
  vi.advanceTimersByTime(9 * 60_000 + 1000); // 9:01 idle
  expect(cb.onWarning).toHaveBeenCalled();
  vi.advanceTimersByTime(60_000); // 10:01 idle
  expect(cb.onLogout).toHaveBeenCalledWith('You were signed out due to inactivity.');
});

it('a force-logout from another tab triggers logout', () => {
  const cb = makeCb();
  sessionManager.init({ idleLogoutMinutes: 10, maxSessionMinutes: null }, cb);
  window.dispatchEvent(new StorageEvent('storage', { key: 'acs.forceLogout', newValue: String(Date.now()) }));
  expect(cb.onLogout).toHaveBeenCalled();
});

it('enforces the absolute session cap', () => {
  const cb = makeCb();
  localStorage.setItem('acs.sessionStartedAt', String(Date.now() - 13 * 60 * 60_000)); // 13h ago
  sessionManager.init({ idleLogoutMinutes: 10, maxSessionMinutes: 720 }, cb);
  vi.advanceTimersByTime(1000);
  expect(cb.onLogout).toHaveBeenCalledWith('Your session reached its maximum length. Please sign in again.');
});
```
(Add cases as time permits: activity resets the warning; suspend jump via `vi.advanceTimersByTime` past idle then `visibilitychange`.)

- [ ] **Step 3: Run** — `pnpm --filter @crm2/web test -- sessionManager` — Expected: PASS. **Commit**
```bash
git add apps/web/src/lib/sessionManager.ts apps/web/src/lib/sessionManager.test.ts
git commit --author="Mayur Kulkarni <mayurkulkarni786@gmail.com>" -m "feat(web): idle session manager (warn-then-logout, cross-tab, cap)"
```

---

### Task 12: `SessionTimeoutModal` (a11y, focus trap)

**Files:**
- Create: `apps/web/src/features/auth/SessionTimeoutModal.tsx`
- Test: Create `apps/web/src/features/auth/SessionTimeoutModal.test.tsx`

- [ ] **Step 1: Write the modal**
```tsx
import { useFocusTrap } from '../../lib/useFocusTrap.js';

interface Props {
  remainingSeconds: number;
  onStay: () => void;
  onLogout: () => void;
}

export function SessionTimeoutModal({ remainingSeconds, onStay, onLogout }: Props): JSX.Element {
  // Escape / focus-trap default action is the SAFE one: stay logged in (never logout).
  const ref = useFocusTrap<HTMLDivElement>(true, onStay);
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-foreground/40 p-4">
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="idle-title"
        aria-describedby="idle-desc"
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg"
      >
        <h2 id="idle-title" className="text-lg font-semibold text-foreground">
          Still there?
        </h2>
        <p id="idle-desc" aria-live="polite" className="mt-2 text-sm text-muted-foreground">
          For your security you’ll be signed out in{' '}
          <span className="font-bold text-destructive">{remainingSeconds}</span> seconds due to
          inactivity.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onLogout}>
            Log out now
          </button>
          <button className="btn" onClick={onStay} autoFocus>
            Stay logged in
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Write the failing test**
```tsx
import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { SessionTimeoutModal } from './SessionTimeoutModal.js';

it('renders an alertdialog with the countdown and both actions', () => {
  const onStay = vi.fn();
  const onLogout = vi.fn();
  render(<SessionTimeoutModal remainingSeconds={42} onStay={onStay} onLogout={onLogout} />);
  expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  expect(screen.getByText('42')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Stay logged in' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Log out now' })).toBeInTheDocument();
});
```
> If `@testing-library/react` / `jsdom` aren't already dev-deps for apps/web, confirm before adding (ALLOWED_DEPENDENCIES gate). If unavailable, assert via a lighter render util already used in the repo, or cover the modal purely in the Playwright e2e (Task 15) and keep this file typecheck-only.

- [ ] **Step 3: Run** — `pnpm --filter @crm2/web test -- SessionTimeoutModal` — Expected: PASS. **Commit**
```bash
git add apps/web/src/features/auth/SessionTimeoutModal.tsx apps/web/src/features/auth/SessionTimeoutModal.test.tsx
git commit --author="Mayur Kulkarni <mayurkulkarni786@gmail.com>" -m "feat(web): accessible session-timeout warning modal"
```

---

### Task 13: AuthContext — device id, session-start anchor, idle-logout path, reason banner

**Files:**
- Modify: `apps/web/src/lib/AuthContext.tsx`
- Modify: the login page component (read+show `logoutReason`)

- [ ] **Step 1: Pass `deviceId` + stamp session start on login** (in `login()` after the POST body and after `tokenStore.set(...)`)
```typescript
  const res = await api<LoginResponse>('POST', '/api/v2/auth/login', {
    username,
    password,
    ...(mfaCode ? { mfaCode } : {}),
    deviceId: tokenStore.deviceId(),
  });
  tokenStore.set(res.tokens.accessToken, res.tokens.refreshToken);
  tokenStore.markSessionStart();
```

- [ ] **Step 2: Add `idleLogout` + `logoutReason` to the context** — state `const [logoutReason, setLogoutReason] = useState<string | null>(null);` exposed on the context value; clear it in `login()` (`setLogoutReason(null)`). Add:
```typescript
  /** Idle/absolute timeout: revoke ONLY this browser session (not logout-everywhere), then drop. */
  const idleLogout = async (reason: string): Promise<void> => {
    const jti = tokenStore.jti();
    if (jti) {
      try {
        await api('POST', `/api/v2/auth/sessions/${jti}/revoke`);
      } catch {
        // best-effort — clear locally regardless
      }
    }
    tokenStore.clear();
    tokenStore.clearSessionStart();
    disconnectSocket();
    setLogoutReason(reason);
    setMustChangePassword(false);
    setMustAcceptPolicies(false);
    setPendingPolicies([]);
    setUser(null);
  };
```
Also add `tokenStore.clearSessionStart()` to the existing `logout()`. Add `idleLogout` and `logoutReason` to the `AuthState` interface + the provider value.

- [ ] **Step 3: Show the reason on the login screen** — in the login page, read `logoutReason` from `useAuth()` and render a small banner (e.g. `<p className="text-sm text-muted-foreground">{logoutReason}</p>`) above the form when set.

- [ ] **Step 4: Typecheck** — `pnpm --filter @crm2/web typecheck` — Expected: PASS. **Commit**
```bash
git add apps/web/src/lib/AuthContext.tsx apps/web/src/features/auth/
git commit --author="Mayur Kulkarni <mayurkulkarni786@gmail.com>" -m "feat(web): this-session idle logout path + logout reason banner"
```

---

### Task 14: `IdleLogoutManager` — wire manager + modal + realtime, behind the role switch

**Files:**
- Create: `apps/web/src/features/auth/IdleLogoutManager.tsx`
- Modify: `apps/web/src/components/Layout.tsx` (or wherever Layout lives) to mount it

- [ ] **Step 1: Write the component**
```tsx
import { useEffect, useState } from 'react';
import { useAuth } from '../../lib/AuthContext.js';
import { sessionManager } from '../../lib/sessionManager.js';
import { tokenStore } from '../../lib/auth.js';
import { onRealtime } from '../../lib/socket.js';
import { SessionTimeoutModal } from './SessionTimeoutModal.js';

export function IdleLogoutManager(): JSX.Element | null {
  const { user, idleLogout } = useAuth();
  const [remaining, setRemaining] = useState<number | null>(null);

  const idle = user?.idleLogoutMinutes ?? null;
  const max = user?.maxSessionMinutes ?? null;

  useEffect(() => {
    if (!user || (idle == null && max == null)) return;
    sessionManager.init(
      { idleLogoutMinutes: idle, maxSessionMinutes: max },
      {
        onWarning: (s) => setRemaining(s),
        onClearWarning: () => setRemaining(null),
        onLogout: (reason) => {
          setRemaining(null);
          void idleLogout(reason);
        },
      },
    );
    // Admin force-logout / cross-device revoke for THIS browser → drop live.
    const myDevice = tokenStore.deviceId();
    const off = onRealtime('auth:session_revoked', (payload) => {
      const p = payload as { deviceId?: string };
      if (p?.deviceId && p.deviceId === myDevice) void idleLogout('Your session was ended.');
    });
    return () => {
      off();
      sessionManager.destroy();
    };
  }, [user, idle, max, idleLogout]);

  if (remaining == null) return null;
  return (
    <SessionTimeoutModal
      remainingSeconds={remaining}
      onStay={() => {
        sessionManager.extend();
        setRemaining(null);
      }}
      onLogout={() => {
        setRemaining(null);
        void idleLogout('You signed out.');
      }}
    />
  );
}
```

- [ ] **Step 2: Mount it** inside `<Layout>` (renders only when a user is present, after App's guards) — e.g. next to `<Toaster>`: `<IdleLogoutManager />`.

- [ ] **Step 3: Typecheck + browser-verify** — `pnpm --filter @crm2/web typecheck`. Then in the preview, log in as a DESK user and confirm (using devtools to shorten via the e2e path, or trust the Playwright run) the manager mounts and no errors log. **Commit**
```bash
git add apps/web/src/features/auth/IdleLogoutManager.tsx apps/web/src/components/Layout.tsx
git commit --author="Mayur Kulkarni <mayurkulkarni786@gmail.com>" -m "feat(web): mount idle-logout manager + realtime revoke behind role switch"
```

---

## Phase 5 — E2E, ADR, finalize

### Task 15: Playwright e2e — warn/stay/logout + FIELD_AGENT exemption (clock fast-forward)

**Files:**
- Modify: `apps/web/e2e/auth.setup.ts` (create a FIELD_AGENT user + a field storageState)
- Create: `apps/web/e2e/idle-logout.spec.ts`

- [ ] **Step 1: Seed a FIELD_AGENT user in setup** — after the admin login + saving the admin state, use the admin token to create a field user via the API (mirror the integration `makeUser`: `POST /api/v2/users` then `POST /api/v2/users/:id/password`), log in as that user in a second context, and save `e2e/.auth/field.json`. (Admin = SUPER_ADMIN is idle-subject, so the DESK case uses the existing admin state.)

- [ ] **Step 2: Write the spec** (DESK warns + stay resets + logout; FIELD no modal)
```typescript
import { expect, test } from '@playwright/test';

test.describe('idle auto-logout', () => {
  test('DESK user is warned then signed out; Stay Logged In resets', async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    await page.clock.fastForward('09:05'); // 9m05s idle → warning
    const dialog = page.getByRole('alertdialog');
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Stay logged in' }).click();
    await expect(dialog).toBeHidden();
    await page.clock.fastForward('08:00'); // not yet at threshold again
    await expect(dialog).toBeHidden();
    await page.clock.fastForward('02:00'); // now past 10m since reset → signed out
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });
});

test.describe('field agent exemption', () => {
  test.use({ storageState: 'e2e/.auth/field.json' });
  test('FIELD_AGENT on web never sees the idle modal', async ({ page }) => {
    await page.clock.install();
    await page.goto('/');
    await page.clock.fastForward('11:00'); // past the DESK threshold
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
});
```
> `page.clock.install()` must run before navigation so the manager's `setInterval`/`Date.now()` use the mock clock. Adjust the role-exemption project wiring so this spec can select the field storageState (a dedicated project, or `test.use`).

- [ ] **Step 3: Run** — `pnpm --filter @crm2/web test:e2e -- idle-logout` (API + web servers auto-start per `playwright.config.ts`) — Expected: PASS across viewports. **Commit**
```bash
git add apps/web/e2e/
git commit --author="Mayur Kulkarni <mayurkulkarni786@gmail.com>" -m "test(web): e2e idle-logout warn/stay/logout + field-agent exemption"
```

---

### Task 16: ADR-0045 + index links

**Files:**
- Create: `docs/adr/ADR-0045-web-session-lifecycle.md`
- Modify: `docs/adr/README.md`, `PROJECT_INDEX.md`

- [ ] **Step 1: Write the ADR** — title "Web session lifecycle: idle auto-logout + 12h absolute cap + FIELD_AGENT carve-out". Capture: context (no v2 idle timeout; v1 had one); decision (model C — FE-driven idle with server-decided per-role `idle_logout_minutes`; server-enforced cap via `absolute_expires_at`; FIELD_AGENT exempt = NULL; SUPER_ADMIN subject; idle/absolute timeout revokes THIS session only, manual logout/change-password stay logout-everywhere; web `deviceId` synthesized to light up `auth:session_revoked`); consequences; alternatives rejected (A FE-only, B server-tracked idle). Reference ADR-0014/0019/0022/0027/0043. Verify ADR-0045 is still free (ADR-0044 = parallel `task-tat-priority`).

- [ ] **Step 2: Link it** — add the row to `docs/adr/README.md` and a pointer under the relevant section of `PROJECT_INDEX.md`.

- [ ] **Step 3: Commit**
```bash
git add docs/adr/ADR-0045-web-session-lifecycle.md docs/adr/README.md PROJECT_INDEX.md
git commit --author="Mayur Kulkarni <mayurkulkarni786@gmail.com>" -m "docs(adr): ADR-0045 web session lifecycle (idle logout + session cap)"
```

---

### Task 17: Full verify + live browser-verify + memory

- [ ] **Step 1: Green gate** — `LC_ALL=C DATABASE_URL=… pnpm verify` (typecheck → lint → format → no-suppressions → boundaries → test → build). Fix anything red.
- [ ] **Step 2: Live browser-verify** (per `feedback_browser_verify_perform_actions`): DESK user → warn at threshold → Stay Logged In resets → let it run → signed out with reason banner; FIELD_AGENT login on web → no modal past the threshold; admin edits MANAGER idle value in `/access/roles` and it persists.
- [ ] **Step 3: Update memory** — add `project_acs_v2_idle_logout_2026_06_18.md` (+ MEMORY.md index line); remove the kickoff prompt `docs/prompts/next-session-idle-logout.md`. Do NOT push to `main` — push the branch, fast-forward main only after live-verify is green and parallel work has settled (per kickoff).

---

## Self-review

**Spec coverage:** §3 matrix → T1 seed; §5.1 migration → T1; §5.2 loader → T2; §5.3 contract → T3/T4; §5.4 login cap → T5; §5.5 refresh cap → T6; §5.6 logout reuse → unchanged (used by T13 idleLogout via revokeSession); §5.7 roles admin → T7/T8; §6.1 manager → T11 (+T9 pause, T10 anchors); §6.2 modal → T12; §6.3 wiring behind role switch → T14; §6.4 realtime → T14 (+T10/T13 deviceId enabler); telemetry → T11 (`logger.info`); §8 tests → T1/T4/T5/T6/T7 (integration), T9/T11/T12 (unit), T15 (e2e); §9 open items → resolved (activeScope absent → dropped; roles UI exists → T8; ADR-0045 free; `withResolvedPermissions` single feeder → T4; SDK seam → `apps/web/src/lib/sdk.ts` T9); §10 DoD → T16/T17.

**Placeholder scan:** the only soft spots are deliberate "confirm-before-editing" notes (findRefresh aliasing style in T5; testing-library availability in T12; Layout path in T14) — each gives the executor the exact fallback. No TODO/TBD left as work.

**Type consistency:** `idleLogoutMinutes`/`maxSessionMinutes` named identically across `RoleAttributes` (T2), `AuthUser` (T3), `RoleView`+schemas (T7), `IdleConfig` (T11), and the manager init (T14). `hasActiveMutations` (T9) consumed by the manager (T11). `tokenStore.deviceId()`/`markSessionStart()`/`clearSessionStart()` (T10) consumed by AuthContext (T13) + manager/`IdleLogoutManager` (T11/T14). `idleLogout`/`logoutReason` (T13) consumed by `IdleLogoutManager` + login page (T14/T13).
