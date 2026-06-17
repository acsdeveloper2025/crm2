# Login Policy Acceptance — Design Spec (2026-06-17)

**Status:** Approved (design) — pending implementation plan.
**Owner sign-off needed for:** new ADR-0042 + FROZEN_DECISIONS_REGISTRY row 35 (new entity + new login gate).
**Replicates:** v1 "Field Executive Acknowledgement" consent feature (`user_consents`), rebuilt the v2 way.

---

## 1. Summary
Add an **admin-managed, versioned policy** that **every user must accept at login** before using the app. Enforcement is **server-driven** (a `mustAcceptPolicies` flag in the login response + a re-check on token refresh), mirroring the existing `mustChangePassword` gate — which is strictly more robust than v1's front-end-only guard. Admins manage policy content + activation in an ADMINISTRATION screen; acceptances are recorded immutably for audit.

**Locked decisions (from brainstorming):**
- Policy content is **admin-managed in the DB** (full CRUD), not static-in-code.
- **All users** must accept (no role filter) — broader than v1's field-agent-only scope.
- **Server-driven** gate (login + refresh), not FE-only.
- **Versioned**: editing a policy's content forces re-acceptance.
- Build now = **v2 API (mobile-compatible) + web**; the mobile client rides the deferred mobile rebase.
- **Starter policy** = v1 Field-Exec Acknowledgement, **seeded ACTIVE** → all users (incl. admins) are gated on first login post-deploy. **Decline = logout**; content authored as **markdown**.
- **Follow the v2 design system + standards everywhere** (DESIGN_AND_STACK_FREEZE, UI_STANDARDS, COLOR tokens, RESPONSIVE_DESIGN_STANDARD, the frozen DataGrid) — reuse existing components; no bespoke UI.

---

## 2. Data model — migration `0068_policy_acceptance.sql`

### `policies` (admin-managed entity)
| Column | Type | Notes |
|---|---|---|
| `id` | `integer GENERATED ALWAYS AS IDENTITY PK` | |
| `code` | `varchar(50)` | UPPER_SNAKE (e.g. `FIELD_EXEC_ACKNOWLEDGEMENT`); partial-unique where `is_active` |
| `name` | `varchar(150)` | display title |
| `description` | `text` | nullable |
| `content` | `text` | markdown body |
| `content_version` | `integer NOT NULL DEFAULT 1` | **acceptance semantics** — bumps only when content is published |
| `is_active` | `boolean NOT NULL DEFAULT false` | gated only when active |
| `effective_from` | `timestamptz NOT NULL DEFAULT now()` | ADR-0017 (active ⇔ `is_active AND effective_from <= now()`) |
| `version` | `integer NOT NULL DEFAULT 1` | **OCC** (ADR-0019) — bumps every update |
| `created_by/updated_by` | `uuid` | actor |
| `created_at/updated_at` | `timestamptz NOT NULL DEFAULT now()` | |

`CREATE UNIQUE INDEX … ON policies (code) WHERE is_active = true;`

### `policy_acceptances` (append-only audit)
| Column | Type | Notes |
|---|---|---|
| `id` | `integer GENERATED ALWAYS AS IDENTITY PK` | |
| `user_id` | `uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE` | |
| `policy_id` | `integer NOT NULL REFERENCES policies(id) ON DELETE RESTRICT` | |
| `content_version` | `integer NOT NULL` | snapshot of the version accepted |
| `accepted_at` | `timestamptz NOT NULL DEFAULT now()` | |
| `ip` | `inet` | normalized |
| `user_agent` | `text` | |
| `source` | `varchar(10) NOT NULL DEFAULT 'WEB'` | CHECK in (`WEB`,`MOBILE`) |
| `created_at` | `timestamptz NOT NULL DEFAULT now()` | |

`UNIQUE (user_id, policy_id, content_version)` · index on `(user_id)`. Rows are **immutable** (append-only; no update/delete in app code).

**Two version columns, on purpose:** `content_version` drives re-acceptance (bumps only on content publish); `version` is OCC for concurrent admin edits (bumps every save).

**Gate rule:** a user is clear when, for **every** policy that is `is_active AND effective_from <= now()`, a `policy_acceptances` row exists for `(user_id, policy_id, current content_version)`. No role filter (all users).

**Seed:** the migration seeds the **permissions** (below) **and** the v1 Field-Exec Acknowledgement text (ported from v1 `fieldExecutiveAcknowledgement.ts`, 10 sections) as a starter policy with **`is_active = true`, `content_version = 1`**. ⚠️ **This gates every existing user — including admins — to accept on their next login immediately after deploy** (intended). The admin still clears the gate by accepting once, then can manage policies. The seeded `content` must be the final approved text before this migration ships.

---

## 3. Backend

### 3.1 Auth gate (extends `apps/api/src/modules/auth/`)
- **`service.login()`** (`service.ts:119`): after existing gates, compute `pendingPolicies = repo.pendingPoliciesForUser(userId)`; add to `LoginResponse`: `mustAcceptPolicies: boolean` + `pendingPolicies: PendingPolicy[]` (`{ id, code, name, content, contentVersion }`).
- **`service.refresh()`** (`service.ts:202`): re-check `pendingPoliciesForUser`; if non-empty, reject (`invalidRefresh()`) → forces re-login. Parallels the password-expiry re-check.
- **`POST /api/v2/auth/accept-policies`** — self-authenticated (no `authorize()`, id from session → IDOR-safe, like `/users/me`). Body `{ policyIds: number[] }` (zod). Records acceptance rows via idempotent upsert (`ON CONFLICT (user_id, policy_id, content_version) DO NOTHING`), captures `ip` + `user_agent` + `source`. Validates every `policyId` is active+effective. Writes audit log `POLICY_ACCEPTED`. Returns `{ ok: true }`.
- **Repository** adds `pendingPoliciesForUser(userId)` (the NOT-EXISTS query) + `acceptPolicies(userId, policyIds, ip, ua, source)`.

### 3.2 Policies admin module (`apps/api/src/modules/policies/`)
Standard `controller → service → repository` (reference module: `verificationUnits/`). Mounted `/api/v2/policies` in `apps/api/src/http/app.ts`.

| Method | Route | Perm | Notes |
|---|---|---|---|
| GET | `/` | `page.policies` | DataGrid list (server paginate/sort/filter; envelope) |
| GET | `/:id` | `page.policies` | detail |
| POST | `/` | `policy.manage` | create (`content_version=1`, `version=1`) |
| PUT | `/:id` | `policy.manage` | update; **OCC-guarded** (requires `version`); if `content` changes → `content_version++` (forces global re-accept) |
| POST | `/:id/activate` · `/:id/deactivate` | `policy.manage` | toggle `is_active` |
| GET | `/:id/acceptances` | `policy.manage` | audit: who accepted, when, version (DataGrid) |

All writes append an audit-log row and use `withTransaction` where multi-statement (ADR-0019). Raw SQL stays in the repository.

---

## 4. SDK contracts (`packages/sdk/src/policies.ts`, exported from `index.ts`)
- `Policy`, `PolicyAcceptance`, `PendingPolicy` interfaces (camelCase).
- `CreatePolicySchema` (code UPPER_SNAKE regex, name, content, description?), `UpdatePolicySchema` (partial + `version` for OCC).
- `AcceptPoliciesSchema = { policyIds: number[] }`.
- Extend `LoginResponse` (`auth.ts`) with `mustAcceptPolicies: boolean` + `pendingPolicies: PendingPolicy[]`.

---

## 5. Frontend (`apps/web`) — follows the v2 design system

### 5.1 Acceptance gate
- **`features/auth/MustAcceptPoliciesPage.tsx`** — full-screen, **no app shell**, mirroring `MustChangePasswordPage`. Renders each pending policy (name + scrollable markdown `content`), an **I Accept** action (accepts all pending → `POST /auth/accept-policies`), and **Log out** (decline → `logout()`). Uses design tokens + shadcn components; responsive (320→1440).
- **`lib/AuthContext.tsx`** — add `mustAcceptPolicies` + `pendingPolicies` state (set from login response, cleared on logout) + `acceptPolicies()` which clears the flag on success.
- **`App.tsx` gate order:** `!user → LoginPage` → MFA → `mustChangePassword → MustChangePasswordPage` → **`mustAcceptPolicies → MustAcceptPoliciesPage`** → app.

### 5.2 Admin screen (`features/policies/`)
- List via the **frozen Universal DataGrid** (Created/Updated columns, server-side, no custom table). Create/edit dialog with a **markdown** content editor (plain textarea + preview — not WYSIWYG for v1). Activate/deactivate actions. An "Acceptances" view (DataGrid) per policy.
- Registered in `components/Layout.tsx` ADMINISTRATION nav as **Policies** (`/admin/policies`, perm `page.policies`); mirrors existing master-data admin screens.

---

## 6. Permissions (`packages/access/src/permissions.ts`)
- `POLICY_MANAGE = 'policy.manage'` (writes) + `POLICY_VIEW = 'page.policies'` (admin list), with `PERMISSION_META` labels/group. Seeded to **SUPER_ADMIN** via the migration (`role_permissions`). The accept endpoint needs **no** permission (self-service).

---

## 7. Governance & standards compliance
- **ADR-0042** — "Login policy acceptance (admin-managed, versioned, all-users gate)"; **FROZEN_DECISIONS_REGISTRY row 35**.
- **OCC** ADR-0019 (`version` guard on `policies`), **effective-from** ADR-0017, **frozen DataGrid** + **PAGINATION_AND_LOADING** + **RESPONSIVE_DESIGN** standards (admin list), **audit logging** (BUSINESS_RULES: policy CRUD + acceptance), **RBAC** default-deny, **naming** (snake SQL / camel TS / kebab routes), **repository pattern** (raw SQL only in repo), **OpenAPI** emit (zod), **MOBILE_API_COMPATIBILITY_MATRIX** entry (`/auth/accept-policies` + pending-policies are a locked mobile contract; `source='MOBILE'`).
- **Design:** reuse the design system / tokens / shadcn; gate mirrors `MustChangePasswordPage`; admin mirrors existing master-data screens. No bespoke tables or palettes.
- **Definition of done:** unit + integration tests (gate clears/blocks, idempotent accept, OCC conflict, content-bump re-accept, RBAC, scope); `pnpm verify` green; browser-verified accept flow persists across reload; coverage floors respected.

---

## 8. Acceptance criteria
1. An active+effective policy → a user who hasn't accepted its current `content_version` gets `mustAcceptPolicies=true` at login and is gated to `MustAcceptPoliciesPage`; cannot reach the app; refresh is rejected until accepted.
2. Accepting records one immutable row per `(user, policy, content_version)` with ip/UA/source; re-submit is idempotent.
3. Admin edits content → `content_version` bumps → all users must re-accept on next login/refresh; metadata-only edits don't.
4. Deactivating a policy removes it from the gate immediately.
5. Concurrent admin edits conflict via OCC (409 `STALE_UPDATE`).
6. Non-admin cannot reach `/api/v2/policies` writes (403); the accept endpoint is self-only (IDOR-safe).

## 9. Scope
- **In:** migration 0068, policies admin module + UI, auth gate (login + refresh + accept), FE gate page, perms + seed, SDK, tests, ADR-0042 + registry row 35, compat-matrix entry.
- **Out (now):** mobile *client* (separate repo; deferred rebase — API built mobile-compatible); notifying users of new/changed policies; rich WYSIWYG editor; per-role targeting (all-users for now).

## 10. Resolved decisions
- **Starter policy seed:** seed v1's Field-Exec Acknowledgement text as an **ACTIVE** policy (`content_version = 1`) → all users gated on first login post-deploy.
- **Decline behavior:** **log out** (v1 parity).
- **Content format:** **markdown** (plain editor); WYSIWYG deferred.
