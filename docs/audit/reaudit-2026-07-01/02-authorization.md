# RE-AUDIT 02: Authorization

Re-audit of area 02 against current HEAD (`8ded432`), baseline `b19039e`. Read-only static inspection.

## Fix Confirmations

| ID | Status | Evidence file:line |
|----|--------|--------------------|
| AUTHORIZATION-04 (USER_MANAGE cannot grant grantsAll/SUPER_ADMIN role) | CONFIRMED_FIXED | `apps/api/src/modules/users/service.ts:199-206` — `assertCanAssignRole(actorRole, targetRole)`: if target role's live `grantsAll` is set, actor must also hold `grantsAll` or throws `CANNOT_GRANT_ELEVATED_ROLE` (403). Wired into all 3 write paths: `create` (`:294`), `update` guarded on role-change (`:339`), `importConfirm→create` (`:328`). `actorRole` sourced server-side from `req.auth?.role` (`controller.ts:21`), not request body — unspoofable. `grantsAll` resolved from the live `role_permissions` table via `getRoleAttributes` (`platform/access/index.ts:20-26`), same source `authorize()` reads. Diff confirms this block + the `actorRole` params are new in the remediation. |
| AUTHORIZATION-02 (socket.io CORS explicit allowlist) | CONFIRMED_FIXED | `apps/api/src/platform/realtime/index.ts:140-146` — `origin: env.NODE_ENV==='production' ? PROD_ORIGIN : DEV_ORIGINS`. Diff: `origin: true` → allowlist. Handshake still independently requires a valid bearer JWT (`resolveSocketIdentity`, `:91-105`), so this is defense-in-depth as documented. |
| AUTHORIZATION-01 (case:updated broadcast reaches whole office room) | STILL_DEFERRED_AS_DOCUMENTED | `apps/api/src/modules/cases/case-events.ts:19,25` — still `emitToOffice(CASE_UPDATED_EVENT, event)` to the shared `perm:office` room, no per-recipient scope. `git diff b19039e..8ded432 -- case-events.ts` empty (untouched). Payload is caseId/caseNumber/status only, no PII; REST reads stay scoped. Matches registry `COMPLIANCE_GAPS_REGISTRY.md:1635-1638`. |
| AUTHORIZATION-03 (verification note — working control) | ACCEPTED_AS_DOCUMENTED | `COMPLIANCE_GAPS_REGISTRY.md:1681`. Confirmed: identity-scoped own-resource routes (jobs/notifications/saved-views/consents) and static catalogs (reference/forms/time) intentionally carry no `authorize()`; all sit behind global `authenticate()`+`enrichAuth()` (`http/app.ts:102-103`) and controllers 401 on unset `req.auth`. Working control, not a gap. |

## New Findings

None.

Independent route re-scan: every `apps/api/src/modules/*/routes.ts` was checked. The 9 modules with zero `authorize()` refs (forms, jobs, notifications, reference, time, telemetry, saved-views, consents, and the unauthenticated bits of auth) are each deliberate — identity-scoped own-resource, static no-PII catalog, or unauthenticated-by-design (`/time`, `/health`, `/version-check`, `/login`, `/refresh`). All are mounted behind the global `authenticate()` chain. No route that should be permission-gated is missing a guard.

`packages/access/{authorize,permissions}.ts` unchanged by the remediation (`git diff` name-only empty) — the guard primitive is intact. The only two `routes.ts` touched (`auth`, `cases`) both *tighten* authz/hardening: `dedupe-search/export` moved from the broad `data.export` to the correct `dedupe.view` (BUSINESS_LOGIC-02 — a real gap closed), plus rate-limiter and `verifySameOrigin()` additions. No permission gate was loosened or removed anywhere in the diff. The `update` fix's `if (v.role !== existing.role)` guard correctly runs the check on any promotion-to-grantsAll while skipping no-op edits and demotions (fail-closed when a role resolves null).

## Verdict

**PASS.** Both claimed fixes (AUTHORIZATION-04, AUTHORIZATION-02) are real and complete against the actual code, with the privilege-escalation gate correctly wired into all three user-write paths and reading the same live role-attribute source as the request-time authorizer. The deferred item (AUTHORIZATION-01) is untouched and still in its documented state; the accepted item (AUTHORIZATION-03) matches its disposition. An independent re-scan of every module's routes and the unchanged `@crm2/access` primitive surfaced zero new findings — the remediation only tightened authorization, introducing no regression.
