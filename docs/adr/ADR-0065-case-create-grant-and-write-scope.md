# ADR-0065 — Desk roles may create cases; case writes are portfolio-scoped

**Status:** Accepted · **Owner-confirmed** (2026-06-25) · **Extends:** ADR-0022 (data scope — read
visibility), ADR-0050 (office desk roles). **Migration:** `0095` (grants `case.create` to BACKEND_USER +
TEAM_LEADER; 0093/0094 reserved by ADR-0064 rate-type phases B/C). **Closes:** RBAC/scope audit findings
SR-1, SR-2, SR-3, SR-4, SR-5, SR-6.

## Context

A read-only RBAC + scope audit (2026-06-25, six agents) found two paired defects behind the owner-reported
bug "a BACKEND_USER cannot create a case/task for their assigned client+product":

1. **Permission gap (SR-4).** `case.create` is enforced by `POST /cases`, `POST /:id/tasks`, and
   `POST /:id/applicants` (`apps/api/src/modules/cases/routes.ts`). Only MANAGER and SUPER_ADMIN held it;
   **BACKEND_USER and TEAM_LEADER did not** (in both the code `ROLE_PERMISSIONS` and the seeded
   `role_permissions` — no drift, the parity test passed because both omitted it). So `authorize(case.create)`
   returned 403 and the web hid the "+ New Case" / Add-Tasks controls.

2. **Write-side scope gap (SR-1/2/3/5/6).** ADR-0022 specified scope only as a *read* visibility model
   ("out-of-scope detail ⇒ 404"); the *write* path was never wired. `cases/service.ts` `create`,
   `addApplicant`, `availableUnits`, and `ratePreview` took only a `userId`, never an `Actor`, and the repo
   INSERTed the caller-supplied `client_id`/`product_id` with only an FK existence check. `addTasks` resolved
   the case with a bare `clientProductOf` (no scope predicate). Result: any `case.create` holder could create
   or mutate cases for **any** client/product — and because the case-visibility hierarchy leg matches
   `created_by`, an out-of-scope case became permanently visible to its creator (a self-sustaining
   cross-tenant breach). Granting #1 without fixing #2 would open this for BACKEND_USER.

## Decision

1. **Grant `case.create` to BACKEND_USER and TEAM_LEADER** (owner: both desk roles open cases for their
   scope). Added to `@crm2/access` `ROLE_PERMISSIONS` (parity reference) and seeded into `role_permissions`
   by migration `0093` (additive, `ON CONFLICT DO NOTHING`, re-run-safe). No new permission, no new route —
   the permission and routes already exist; this only widens who holds it.

2. **Validate the target client/product against the actor's CLIENT/PRODUCT scope on every case write.** A new
   `assertClientProductInScope(actor, clientId, productId)` in `cases/service.ts` uses the existing
   `scopedEntityIds(actor, dimension)` — the *same* set that scopes the create form's client/product
   dropdowns — so a write can only target what the actor could have picked:
   - `undefined` (dimension unwired for the role — SUPER_ADMIN/MANAGER/TEAM_LEADER) ⇒ unrestricted;
   - an array (including `[]`, a RESTRICT cap with no assignment) ⇒ membership required, else **400
     `CLIENT_OUT_OF_SCOPE` / `PRODUCT_OUT_OF_SCOPE`** (400, not 403 — the actor is authorized for the action;
     the specific entity is just outside their portfolio, mirroring `INVALID_ASSIGNEE`).

   `create`, `availableUnits`, `ratePreview` call it; `addTasks` and `addApplicant` first gate on
   `caseVisible(caseId, resolveScope(actor))` → 404 (the case itself must be in scope before mutation). The
   controller threads the full `Actor` (was `userId`) into all five.

   Note a consequence of ADR-0022 wiring: BACKEND_USER has CLIENT as EXPAND but PRODUCT as a RESTRICT cap
   (mig 0049), so a BACKEND_USER must hold both a CLIENT and a PRODUCT scope assignment to create anything —
   exactly mirroring what its create-form dropdowns would offer.

## Consequences

### Positive

- BACKEND_USER and TEAM_LEADER can create cases/tasks for their portfolio (the reported bug).
- Closes a real cross-tenant create/mutate hole: case writes now respect the same scope as case reads.
- Write-validation reuses existing infra (`scopedEntityIds`, `caseVisible`) — wiring, not new design.
- The parity test stays green (code grant + seeded grant move together).

### Negative

- A BACKEND_USER with no PRODUCT scope assignment can now create nothing (RESTRICT cap, fail-closed) — this
  is correct least-privilege but requires admins to assign both CLIENT and PRODUCT scope to desk creators.
- TEAM_LEADER, having no CLIENT/PRODUCT scope wiring, creates unrestricted-by-dimension (like MANAGER);
  hierarchy still governs subsequent visibility.

## Alternatives Considered

- **Grant `case.create` only, defer the scope wiring.** Rejected — it opens the cross-tenant create hole
  for the newly-granted role.
- **403 instead of 400 for out-of-portfolio.** Rejected — the actor *is* authorized for the action; a 400
  validation error (bad client/product choice) matches the existing `INVALID_ASSIGNEE` convention and avoids
  conflating authorization with input validity.
- **Grant BACKEND_USER only (not TEAM_LEADER).** The owner chose both.

## Related ADRs

- **ADR-0022** — data scope (read visibility); this extends it to write validation.
- **ADR-0050** — office desk roles (BACKEND_USER/TEAM_LEADER close/finalize); this adds case creation.
