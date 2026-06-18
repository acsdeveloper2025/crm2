# ADR-0043: Login policy acceptance — admin-managed, versioned, all-users server-driven gate

- **Status:** Accepted (reconciled — see note below)
- **Date:** 2026-06-17
- **Reference spec:** [docs/specs/2026-06-17-login-policy-acceptance-design.md](../specs/2026-06-17-login-policy-acceptance-design.md) (design) · [docs/plans/2026-06-17-login-policy-acceptance-plan.md](../plans/2026-06-17-login-policy-acceptance-plan.md) (implementation plan).
- **Replicates (v1):** the "Field Executive Acknowledgement" consent feature (`user_consents`), rebuilt the v2 way.

> **Reconciliation (post-merge with mobile-parity):** acceptances are **not** stored in a dedicated
> `policy_acceptances` table. They live in the **shared `consents` store** (the mobile-parity DPDP
> table, `0070_mobile_consents.sql`), keyed by `(user_id, policy_version = policies.content_version)`.
> The `policies` table (this ADR's migration, now `0072_policy_acceptance.sql`) remains the
> **admin-managed content/version master**. Web records acceptance via the shared
> **`POST /api/v2/consents/accept`** endpoint (`{ policyVersion }`, idempotent UPSERT) — the original
> `POST /api/v2/auth/accept-policies` endpoint, the `policy_acceptances` table, and the per-policy
> `/acceptances` audit view were removed. The gate rule is otherwise unchanged: a user is clear when,
> for every active+effective policy, a `consents` row exists at the policy's current `content_version`.
> (Sections below describing `policy_acceptances` / `accept-policies` reflect the pre-reconciliation
> design.) Because `consents` is keyed by version only (not policy id), the gate assumes a single
> active policy at a time — distinct active policies that share a `content_version` would be cleared by
> one acceptance.

## Context

v1 ships a "Field Executive Acknowledgement" — a code-of-conduct / anti-bribery / confidentiality / DPDP data-and-location consent that field agents had to accept. Two structural weaknesses make it a DON'T-REGRESS to fix, not port:

1. **Front-end-only guard.** v1 decides whether to show the acknowledgement in the client (`CRM-FRONTEND/src/constants/fieldExecutiveAcknowledgement.ts`). Anyone who bypasses the FE (a direct API call, a stale build, a patched bundle) is never gated — the consent is advisory, not enforced.
2. **Static-in-code content.** The policy text is a TypeScript constant. Changing it is a code deploy; there is no audit of who accepted which version, and no way for the business to revise it without engineering.

CRM2 already has a proven, **server-driven** login gate — `mustChangePassword`: the server computes a boolean on the login response, the FE blocks into a full-screen page with no app shell, and `refresh()` re-checks so an in-flight session cannot evade it. We want policy acceptance to inherit exactly that robustness rather than v1's FE-only posture.

The business requirements (locked at brainstorming):

- **Admin-managed in the DB** (full CRUD), not static-in-code — the business revises content without a deploy.
- **All users** must accept (no role filter) — broader than v1's field-agent-only scope.
- **Versioned** — revising a policy's content forces every user to re-accept.
- **Immutable audit** — one append-only row per `(user, policy, content_version)` recording who accepted what, when (with ip / user-agent / source).
- Build now = **v2 API (mobile-compatible) + web**; the mobile *client* rides the deferred `/api/mobile` → `/api/v2` rebase (ADR-0012, `MOBILE_API_COMPATIBILITY_MATRIX.md`).
- Starter policy = the v1 Field-Exec Acknowledgement text, **seeded ACTIVE** → every existing user (admins included) is gated to accept it on first login post-deploy (intended). **Decline = logout** (v1 parity); content authored as **markdown**.

## Decision

We will add an **admin-managed, versioned policy entity that every user must accept at login**, enforced **server-side** on both login and token refresh — mirroring the `mustChangePassword` gate. Concretely:

1. **Data model (migration `0068_policy_acceptance.sql`).** Two tables:
   - **`policies`** — the admin-managed document: `code` (UPPER_SNAKE, partial-unique where `is_active`), `name`, `description`, `content` (markdown), `is_active`, `effective_from` (ADR-0017), audit columns, and **two distinct version columns on purpose**:
     - **`content_version`** — **acceptance semantics**. Bumps **only** when content is published. A user is clear for a policy iff a `policy_acceptances` row exists at the *current* `content_version`; bumping it re-gates everyone.
     - **`version`** — the **OCC token** (ADR-0019). Bumps on **every** save, guards concurrent admin edits, surfaces as 409 `STALE_UPDATE`. It is unrelated to re-acceptance.
   - **`policy_acceptances`** — append-only audit: `(user_id, policy_id, content_version)` unique, plus `ip`, `user_agent`, `source` (`WEB` | `MOBILE`), `accepted_at`. Rows are immutable — no update/delete in app code.
   - **Gate rule:** a user is clear when, for **every** policy that is `is_active AND effective_from <= now()` (the ADR-0017 usability predicate), a `policy_acceptances` row exists for `(user_id, policy_id, current content_version)`. No role filter — all users.

2. **Server-driven enforcement (auth module).**
   - **`login()`** computes `pendingPoliciesForUser(userId)` (a `NOT EXISTS` query) and returns two new `LoginResponse` fields: **`mustAcceptPolicies: boolean`** and **`pendingPolicies: PendingPolicy[]`** (`{ id, code, name, content, contentVersion }`).
   - **`refresh()`** re-checks `pendingPoliciesForUser` and rejects (`invalidRefresh()`) when non-empty — exactly parallel to the password-expiry re-check, so an in-flight session cannot evade a newly-active or newly-bumped policy.
   - **`POST /api/v2/auth/accept-policies`** — self-service, authenticated (id from the session, **no `authorize()`** → IDOR-safe, like `/users/me`). Body `{ policyIds: number[], source? }` (zod). Records acceptance rows via an idempotent upsert (`ON CONFLICT (user_id, policy_id, content_version) DO NOTHING`), **snapshotting the server-side `content_version`** (the client's claim is ignored), and capturing `ip` / `user_agent` / `source`. Validates every `policyId` is active+effective.

3. **Policies admin module (`/api/v2/policies`).** Standard `controller → service → repository` mirroring `verificationUnits/`. List (DataGrid, server-side envelope), get, create (`content_version=1`, `version=1`), **OCC-guarded** update (requires `version`; a `content` change → `content_version++` → forces global re-accept; metadata-only edits do not), activate/deactivate, and a per-policy `/acceptances` audit view. All writes append an audit row and use `withTransaction` (ADR-0019); raw SQL stays in the repository.

4. **Permissions + admin surface.** Two codes in `@crm2/access`: **`policy.manage`** (`POLICY_MANAGE`, writes) and **`page.policies`** (`POLICY_VIEW`, the admin list). Writes are SUPER_ADMIN-only by seed; `page.policies` is granted to the office admin role so the nav shows. The **accept** endpoint needs **no** permission (self-service). A new **Policies** entry under the ADMINISTRATION nav (`/admin/policies`, perm `page.policies`).

5. **Frontend gate.** `AuthContext` carries `mustAcceptPolicies` + `pendingPolicies` (set from the login response, cleared on logout) and an `acceptPolicies()` action. `App.tsx` inserts the gate after the password gate: `!user → LoginPage` → MFA → `mustChangePassword → MustChangePasswordPage` → **`mustAcceptPolicies → MustAcceptPoliciesPage`** → app. The gate page renders each pending policy's markdown `content` with **I Accept** (accepts all → `POST /auth/accept-policies`) and **Log out** (decline → `logout()`), mirroring `MustChangePasswordPage` (design tokens, no app shell). The admin screen mirrors the existing master-data features on the frozen DataGrid with a markdown content editor.

6. **Starter policy.** The migration seeds the v1 Field-Exec Acknowledgement text (10 sections, ported verbatim) as an **ACTIVE** policy at `content_version = 1` → every user is gated on first login post-deploy (intended). Admins clear the gate by accepting once, then manage policies normally.

## Consequences

### Positive

- **Enforcement is server-authoritative**, not advisory: the gate cannot be bypassed by a patched / stale FE, and `refresh()` re-checks so an in-flight session is caught on the next token rotation. Strictly more robust than v1's FE-only guard.
- **The business revises policy content without a code deploy** — content lives in the DB with full CRUD and an admin Designer-style screen.
- **The two-version split is the whole trick.** `content_version` cleanly expresses re-acceptance (bump → everyone re-accepts) while `version` independently handles concurrent-edit safety (ADR-0019). Neither overloads the other.
- **Immutable, complete audit** — one row per `(user, policy, content_version)` with ip / UA / source answers "who accepted which version, when" for DPDP/compliance, and the idempotent upsert makes re-submits free.
- **Maximum reuse:** mirrors `mustChangePassword` (gate), `verificationUnits` (admin module), the frozen DataGrid, ADR-0017 (effective-from), ADR-0019 (OCC). No bespoke patterns, no new framework.
- **Mobile-ready by construction:** the contract (`accept-policies` + the login fields + `source='MOBILE'`) is built mobile-compatible now; the mobile client adopts it for free when the `/api/mobile` → `/api/v2` rebase lands (ADR-0012).

### Negative

- **The ACTIVE seed gates everyone — including admins — on the very next login post-deploy.** Intended, but operationally a hard cutover: the seeded `content` must be the final approved text before the migration ships, and admins must accept once before they can manage policies.
- **Bumping `content_version` re-gates every user globally** — there is no per-role or staged rollout (all-users by design). A careless content edit forces a fleet-wide re-accept.
- **No user-notification of new/changed policies** (out of scope now) — users discover a new/bumped policy only at their next login/refresh.
- **Markdown is rendered as plain scrollable text** (no WYSIWYG) for v1; richer authoring/preview is deferred.
- A second login gate adds another branch to the `App.tsx` gate order and another `pendingPoliciesForUser` query on every login and refresh (a single indexed `NOT EXISTS` — negligible, but non-zero).

## Alternatives Considered

- **Static-in-code policy text (v1's approach)** — rejected: every revision is a code deploy, there is no per-version acceptance audit, and the business cannot self-serve content. Admin-managed DB content is the requirement.
- **Front-end-only guard (v1's approach)** — rejected: advisory, not enforced; bypassable by a direct API call or stale/patched bundle, with no refresh re-check. The server-driven `mustAcceptPolicies` flag + refresh re-check is strictly more robust and reuses the proven `mustChangePassword` pattern.
- **A single `version` column doing double duty** (re-acceptance *and* OCC) — rejected: every concurrent admin edit (even a typo fix or a metadata-only change) would bump the token and force a fleet-wide re-accept. Splitting `content_version` (publish-only) from `version` (every-save OCC) keeps the two concerns independent.
- **Per-role / per-territory targeting** — deferred (all-users for now): adds scope-resolution complexity for no current requirement; the gate rule stays "every active+effective policy, no role filter".
- **Mutable acceptance rows (one row per user/policy, updated on re-accept)** — rejected: destroys the audit trail. Append-only rows per `(user, policy, content_version)` preserve the full history.

## Related ADRs

- [ADR-0019](./ADR-0019-concurrency-and-editing-standard.md) — OCC `version` token on `policies` (concurrent admin edits → 409 `STALE_UPDATE`).
- [ADR-0017](./ADR-0017-effective-from-temporal-usability-gating.md) — `effective_from`; a policy is gated only when `is_active AND effective_from <= now()`.
- [ADR-0022](./ADR-0022-access-control-2.0-configurable-roles-and-scope.md) — `policy.manage` / `page.policies` as catalog permissions; FE gates on permissions, not role names.
- [ADR-0012](./ADR-0012-mobile-integration-strategy.md) — the mobile client consumes `accept-policies` + the login fields (`source='MOBILE'`) when it rebases `/api/mobile` → `/api/v2`.
- [ADR-0011](./ADR-0011-api-versioning-strategy.md) — single `/api/v2` contract shared by web + mobile.
