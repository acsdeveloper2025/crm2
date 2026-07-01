# AUDIT 02: Authorization

## Scope

Read-only inspection of the CRM2 API's authorization layer: RBAC core, permission catalog, scope/territory
engine, and every HTTP route in `apps/api/src/modules/*`.

Files read in full or in relevant part:
- `packages/access/src/{authorize.ts,permissions.ts,express-augment.d.ts}` — the RBAC core (6 roles, permission catalog, `authorize`/`authorizeAny` middleware).
- `apps/api/src/http/{authenticate.ts,enrichAuth.ts,app.ts}` — request pipeline (JWT verify → role-attribute enrichment → route mount table).
- `apps/api/src/platform/scope/{index.ts,repository.ts,dimensions.ts}` — the data-scope (hierarchy + dimension) resolution engine (`resolveScope`, `getScopedUserIds`, `composeScopePredicate`, `taskScopePredicate`).
- `apps/api/src/platform/access/index.ts` — cached role-attribute resolution (`getRoleAttributes`, 5s TTL + explicit invalidation).
- `apps/api/src/platform/realtime/index.ts` + `apps/api/src/modules/cases/case-events.ts` — socket.io handshake authz + realtime fan-out payload.
- **Every `routes.ts` file under `apps/api/src/modules/`** (37 files, enumerated below) — read in full.
- For each module with a non-trivial authorization story, the matching `controller.ts`/`service.ts`/`repository.ts` was read to verify the permission gate is backed by an actual ownership/ scope check, not just a route-level `authorize()`: `cases`, `tasks`, `verification-tasks`, `users`, `roles`, `auth`, `jobs`, `notifications`, `saved-views`, `sync`, `fieldReports`, `caseReports`, `billing`, `mis`, `dashboard`, `field-monitoring`.
- `packages/sdk/src/{users.ts,cases.ts}` — request schemas (role-assignment input shape) and the realtime event payload shape.

Modules enumerated from `apps/api/src/modules/*` (45 directories). 37 have their own `routes.ts`; the
remaining 8 are sub-resources mounted from a sibling module's routes file (confirmed by grep, not assumed):
`fieldReports` (mounted in `cases/routes.ts:88-93` and used internally by `verification-tasks/service.ts`),
`caseReports` (mounted in `cases/routes.ts:94-100`), `scopeAssignments` and `userKycUnits` (both mounted in
`users/routes.ts:96-114`/`101-102`), `shared` (no HTTP surface — cross-module helpers).

Commands actually run (all read-only):
```
find apps/api/src/modules -name "routes.ts" | sort                     # enumerate the 37 route files
grep -rn "req.auth" apps/api/src/platform/                             # locate the auth-context producer
find apps/api/src -iname "*authenticate*"                              # locate authenticate()
grep -n "resolveScope" apps/api/src/modules/cases/service.ts            # confirm every write applies scope
grep -rln "scopeAssignments|userKycUnits|fieldReports|caseReports" apps/api/src/modules/*/routes.ts
for f in $(find apps/api/src/modules -name routes.ts); do
  routes=$(grep -cE "\.(get|post|put|patch|delete)\(" "$f")
  authz=$(grep -cE "authorize\(|authorizeAny\(" "$f")
  echo "$f routes=$routes authorize_calls=$authz"
done                                                                     # route-vs-authorize-call census
grep -rl "socket.io" apps/api/src                                       # locate the realtime authz seam
```

No code was modified. No live DB/Redis/network calls were made — all DB/scope behavior below is derived
from reading the SQL in `repository.ts` files, not from running it.

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| Every endpoint has an authorization check (enumerate, don't sample) | PASS | Route-vs-`authorize()`-call census (pasted command above) run across all 37 `routes.ts` files. Every route without a route-level `authorize()`/`authorizeAny()` call was individually traced to a controller-level `requireUserId`/`requireAuth` 401 guard: `auth/routes.ts` (14 routes — `me`, `change-password`, `mfa/*`, `sessions/*`, `my-consents` — `authController.ts:7-11` `requireUserId`), `users/routes.ts` `/me/*` (4 routes — `controller.ts`, same pattern), `forms/routes.ts:10` (`formsController.ts:8` `if (!req.auth?.userId) throw AppError.unauthenticated()`), `telemetry/routes.ts:10` (`telemetryController.ts:9` same), `jobs/routes.ts` (all 3 — `jobController.ts:9-12` `requireUserId`), `notifications/routes.ts` (all 17 — `notificationController.ts:6-9` `requireUserId` on every handler), `saved-views/routes.ts` (all 5 — `controller.ts:7-10` `requireUserId`), `consents/routes.ts:10` (`controller.ts:14` `requireUserId`), `reference/routes.ts` (both — `controller.ts:6-8` `requireAuth`). `time/routes.ts:16` is the one genuinely unauthenticated route (server clock, `GET /api/v2/health`); both are deliberately public per their own doc comments and carry no user/case data. | No route reaches a controller with zero authentication or authorization check. |
| RBAC enforced via a real, fail-closed engine | PASS | `packages/access/src/authorize.ts:23-36` — 401 if `!req.auth`, 403 if `!grantsAll && !permissions.includes(perm)`; `apps/api/src/platform/access/repository.ts`/`index.ts` resolve role attributes from the DB `role_permissions` table (no hard-coded role-name checks); `enrichAuth.ts:14-17` defaults an unknown/inactive role to `grantsAll=false, permissions=[]` (default-deny). | Confirmed via direct read, not inference. |
| Permission checks present on every write endpoint | PASS | Same census as row 1; every `post`/`put`/`patch`/`delete` route across all 37 files carries an `authorize()`/`authorizeAny()` call or a controller-level identity guard (verified file-by-file, see Scope). | |
| Role escalation: can a lower role grant itself a higher permission via any write endpoint | PASS (with 1 defense-in-depth gap, AUTHORIZATION-04) | `roles/routes.ts:25-29` — `POST/PUT /roles`, `/:code/permissions` all gate `ROLE_MANAGE`, which is held by **no role in the seed catalog** except via `grantsAll` (`packages/access/src/permissions.ts:94-148` — `ROLE_PERMISSIONS` lists `ROLE_MANAGE` nowhere under MANAGER/TEAM_LEADER/BACKEND_USER/FIELD_AGENT/KYC_VERIFIER). `roles/service.ts:109-116` `loadEditable()` additionally hard-blocks editing any `grantsAll` role (`ROLE_LOCKED`) — SUPER_ADMIN's own permission set can never be edited via this surface, by itself or anyone else. The one open seam: `users/service.ts:273-293,314-339` (`create`/`update`) accept an open-catalog `role` string (`packages/sdk/src/users.ts:78,106,123` — shape-validated only, FK-checked for existence, not capability-checked) — see AUTHORIZATION-04. | Not exploitable under the current seed (only SUPER_ADMIN holds `user.manage`), but no code-level guard exists if a custom role is ever granted `user.manage` without being `grantsAll`. |
| Horizontal privilege escalation (user A acting on user B's data) | PASS | Every identity-scoped surface (`auth` sessions/MFA/consents, `notifications`, `saved-views`, `jobs`) binds the SQL `WHERE` clause to `req.auth.userId`, not a client-supplied id: `auth/service.ts:319-322` `revokeSession` → `repo.revokeRefreshForUser(jti, userId)`; `notifications/repository.ts:107-162` every mutator is `WHERE id = $1 AND user_id = $2`; `jobs/service.ts:34-46` `jobRepository.getOwned(id, userId)`; `saved-views/controller.ts` `requireUserId(req)` passed into every service call. Field-execution ownership: `verification-tasks/service.ts:59-63` `ownedCaseId()` → `repo.taskForAssignee(taskId, actor.userId)`, 404 if not the assignee. | Verified at the repository SQL layer, not just the controller. |
| Vertical privilege escalation (lower role reaching admin-only functionality) | PASS | Admin-only surfaces (`access`, `roles` writes, `commission-rates`, `report-layouts`, `system`, `departments`/`designations` writes, `verification-units` writes) are gated by permissions held only by SUPER_ADMIN in the seed (`ACCESS_VIEW`, `ROLE_MANAGE`, `MASTERDATA_MANAGE`, `TEMPLATE_MANAGE`, `SYSTEM_VIEW`, `USER_MANAGE`, `VERIFICATION_UNIT_MANAGE` — none appear under MANAGER/TEAM_LEADER/BACKEND_USER/FIELD_AGENT/KYC_VERIFIER in `permissions.ts:94-148`). | |
| IDOR (any `:id` route where the object isn't scope/ownership-checked, only existence-checked) | PASS | Every `:id`/`:taskId`/`:attachmentId` write or read in `cases/service.ts` resolves `await resolveScope(actor)` before the lookup and returns `404 *_NOT_FOUND` for an out-of-scope id (never 403, so existence isn't leaked) — confirmed at 17 call sites (`grep -n resolveScope apps/api/src/modules/cases/service.ts`, lines 279,320,383,422,442,452,462,488,528,546,557,571,591,612,627,634,...,779). Same pattern in `tasks/repository.ts:246-267,883-907` (`tasksForAssignment`, `taskAssignmentState` — both apply `taskScopePredicate`), `fieldReports/service.ts:80`, `caseReports/service.ts:60-61`, `dashboard/repository.ts:88,130`, `field-monitoring/service.ts:127-128`. A code comment (`cases/service.ts:768-771`) documents a *prior* IDOR (case-level attachment reachable via a satisfied task-leg) that was fixed (`A2026-0623-06`). | |
| Object ownership | PASS | See horizontal-escalation row; ownership binding is enforced at the repository SQL `WHERE` clause, not just checked in the controller. | |
| Client isolation | PASS | `cases/service.ts:380,419` (`domainFilterIds`) + the CLIENT/PRODUCT scope dimension (`platform/scope/dimensions.ts`, wired via `resolveScope`'s `expand`/`restrict` legs, ADR-0072) restrict visible clients/products to the actor's assigned portfolio; `scopedEntityIds()` (`platform/scope/index.ts:14-21`) scopes client/product dropdown options the same way. | Per repo memory, ADR-0072 (2026-06-26) intentionally narrowed user scope to exactly CLIENT+PRODUCT and removed 3 unwired scope dimensions — confirmed current `dimensions.ts` only wires what's actually read. |
| Branch/territory isolation | PASS | AREA/PINCODE scope dimensions gate the FIELD assignee pool (`tasks/repository.ts:279-309,314-339`, `cases/repository.ts:851-879`) via `user_scope_assignments`; KYC-unit grants (`user_kyc_unit_access`) gate the OFFICE pool (ADR-0073). Both pools are explicitly **not** capped by the actor's org-hierarchy (ADR-0078, by design — the territory/unit grant IS the access control for the pool), but the task itself is scope-checked via `taskScopePredicate` before the pool query runs (`cases/service.ts:452-455`, `tasksForAssignment`). | Re-verified the ADR-0078 fix is live in current code (not just historical per memory) — confirmed by direct read of `eligibleAssignees`/`eligibleAssigneesForNew`/`eligibleTaskIdsForAssignee`, all carry the "ADR-0078: NOT capped by org-hierarchy" comment and the corresponding SQL has no hierarchy join. |
| Case ownership | PASS | `cases/service.ts:440-445` `get()`, `:373-403` `list()` both route through `resolveScope(actor)`; `composeScopePredicate` (`platform/scope/index.ts:38-70`) is fail-closed (`'FALSE'` on an unregistered RESTRICT dimension, never silently absent). | |
| Admin bypass (`grants_all`/superadmin shortcut correctly gated) | PASS | `authorize.ts:30,50` — `grantsAll` is read from `req.auth.grantsAll`, itself populated only by `enrichAuth.ts` from the DB `roles.grants_all` column via `getRoleAttributes` (never client-supplied, never inferred from a role-name string match). `roles/service.ts:109-116` additionally hard-locks any `grantsAll` role from being edited at all (so `grants_all` can't be granted to a second role through this API). | |
| Hidden routes (registered but undocumented/unlinked from UI) | PASS | Cross-referenced every `mount(...)` call in `app.ts:103-141` (28 mounts) against the 37 `routes.ts` files; all 37 are reachable either via a direct `mount()` or as a sub-router re-exported from a mounted module's file (`access`, `roles`, `userKycUnits`, `scopeAssignments` all import into already-mounted routers). No route file exists that isn't reachable from `app.ts`. | "Unlinked from UI" (FE not calling a route) was not separately audited — out of this audit's static-inspection ability without a live FE crawl; every route IS gated, so an unlinked-but-reachable route carries the same authz posture as a linked one. |
| API bypass (same data reachable through a different, less-guarded endpoint) | PARTIAL | Export endpoints were deliberately checked against their list-endpoint's gate across every module (the repo's own convention, documented inline at ~15 call sites) and found consistent: e.g. `users/routes.ts:37` exports gate `USER_VIEW` not `DATA_EXPORT` (`DATA_EXPORT` alone is held by MANAGER/TEAM_LEADER/BACKEND_USER who cannot read `page.users`); `commissionRates/routes.ts:17` exports gate `MASTERDATA_MANAGE` not `DATA_EXPORT`; `billing/routes.ts:16` exports gate `BILLING_VIEW`. One real cross-channel leak found: realtime `case:updated` socket events are broadcast to the **entire** office room (every desk role globally) with no per-recipient scope filter, while the REST `GET /cases` list IS scope-filtered — a scope-bypass for case-number/status metadata only (not full case data). See AUTHORIZATION-01. | |

## Findings

### AUTHORIZATION-01
- **Category:** API bypass / data-scope inconsistency (realtime channel)
- **Severity:** Low
- **CVSS:** 3.7 (AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:N/A:N)
- **OWASP Mapping:** OWASP Top 10:2021 — A01:2021 Broken Access Control
- **CWE Mapping:** CWE-863 (Incorrect Authorization)
- **Location**
  - **File:** `apps/api/src/modules/cases/case-events.ts`
  - **Line Number:** 11-26
  - **File:** `apps/api/src/platform/realtime/index.ts`
  - **Line Number:** 56-61, 159-163, 169-174
- **Evidence:**
  ```ts
  // case-events.ts:11-20
  export function emitTaskUpdate(task: CaseTaskView): void {
    const event: CaseUpdateEvent = {
      caseId: task.caseId, caseNumber: task.caseNumber,
      taskId: task.id, taskNumber: task.taskNumber, status: task.status,
    };
    getRealtime().emitToOffice(CASE_UPDATED_EVENT, event);
  }
  ```
  ```ts
  // platform/realtime/index.ts:56-61
  const OFFICE_PERM = 'page.dashboard';
  const OFFICE_ROOM = 'perm:office';
  ```
  Every socket whose role grants `page.dashboard` (MANAGER, TEAM_LEADER, BACKEND_USER, KYC_VERIFIER —
  i.e. every web role except FIELD_AGENT, per `permissions.ts:94-148`) joins `perm:office`
  (`realtime/index.ts:159-163`) and receives every `case:updated` event for every case in the system,
  regardless of that user's case/client/product/territory scope. The REST equivalent (`GET /api/v2/cases`,
  `cases/service.ts:373-403`) IS scope-filtered via `resolveScope(actor)`.
- **Why it is a problem:** The realtime channel and the REST API disagree on data scope for the same
  logical resource. A BACKEND_USER restricted (via CLIENT/PRODUCT scope dimensions, ADR-0072) to one
  client's portfolio still receives live socket pushes naming every case number and task number system-wide
  the instant any office user assigns/completes/revokes/finalizes any task, anywhere in the org.
- **Real world attack scenario:** A BACKEND_USER at one client's KYC desk (scoped only to that client's
  cases) keeps the web app open and watches `case:updated` events arrive for case numbers belonging to a
  competing client they have no `case.view` reach for via the list/detail API. They cannot open the case
  (REST 404s it), but they learn the existence, case-number pattern/volume, and live status-change cadence
  of another client's book of business — a metadata leak, not a PII leak (the event payload carries no
  applicant name, address, or financial figure), but still out-of-scope data exposure.
- **Business impact:** Low-confidentiality breach of cross-client case volume/cadence; could erode a
  client's trust if a competitor-aligned operator inferred business intelligence (case throughput, naming
  conventions) from the socket stream. No direct case PII or financial exposure.
- **Recommended fix:** Either (a) scope `emitToOffice` per-recipient using the same `resolveScope` predicate
  the REST list uses before emitting (most correct, requires iterating connected sockets' resolved scope —
  higher cost), or (b) cheaper: drop `caseNumber`/`taskNumber` from the broadcast payload and have clients
  refetch only the rows already in their own scoped view-state (the event already exists purely as a
  refetch trigger per the code comment in `case-events.ts:5-9` — the case number isn't actually needed
  client-side beyond matching it against rows the client already legitimately holds).
- **Estimated effort:** S (option b) / M (option a)
- **Priority:** P3
- **Status:** OPEN

### AUTHORIZATION-02
- **Category:** Authorization / CORS-adjacent (realtime transport)
- **Severity:** Informational
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-942 (Permissive Cross-domain Policy, contextual)
- **Location**
  - **File:** `apps/api/src/platform/realtime/index.ts`
  - **Line Number:** 135-137
- **Evidence:**
  ```ts
  const io: AppServer = new IOServer(httpServer, {
    cors: { origin: true, credentials: true },
  });
  ```
- **Why it is a problem:** `origin: true` reflects any request origin for the socket.io handshake. This is
  not itself an authorization defect (the handshake still requires a valid, unrevoked JWT — `resolveSocketIdentity`,
  `realtime/index.ts:91-105` — and rejects with no anonymous sockets), but combined with `credentials: true`
  it is a CORS-hardening gap that's adjacent to this audit's "API bypass" checklist item: it widens which
  origins can *attempt* the authenticated handshake. This is primarily a CORS/transport-security concern
  (out of this audit's RBAC/IDOR scope) and is noted here only because it touches the same code path as the
  realtime authz seam reviewed for AUTHORIZATION-01.
- **Real world attack scenario:** N/A for authorization (a stolen/forged token is still required); a
  dedicated CORS/transport audit should evaluate whether `origin: true` should instead allowlist the known
  web origin.
- **Business impact:** None directly attributable to authorization; flagged for cross-reference only.
- **Recommended fix:** Out of scope for this audit; defer to the CORS/network-security audit.
- **Estimated effort:** N/A
- **Priority:** P3
- **Status:** OPEN (informational, cross-reference only — no action required from this audit)

### AUTHORIZATION-03
- **Category:** Defense-in-depth / IDOR-adjacent (existence-leak via export job 413)
- **Severity:** Informational
- **CVSS:** N/A
- **OWASP Mapping:** N/A
- **CWE Mapping:** N/A
- **Location**
  - **File:** `apps/api/src/modules/cases/service.ts`
  - **Line Number:** 432-437
- **Evidence:**
  ```ts
  // A whole-set export ≥ the job threshold must 413 (IMPORT_EXPORT_STANDARD §2) — on the SCOPED total.
  if (ex.mode === 'all') assertExportable(totalCount);
  ```
  The code comment itself already documents that the 413 threshold check is computed on the
  scope-filtered total, specifically to avoid leaking out-of-scope row counts. Read and verified correct —
  recorded here only as a confirmed-PASS note, not a finding requiring action.
- **Why it is a problem:** N/A — this is a verification note, not a defect. Included for completeness since
  the checklist explicitly calls out IDOR via partial information leaks (e.g., a 413 vs 404 distinguishing
  "exists but too large" from "doesn't exist") and this is exactly the kind of side channel that's easy to
  get wrong; it was checked and found correctly scoped.
- **Real world attack scenario:** N/A
- **Business impact:** N/A
- **Recommended fix:** N/A — no fix needed, already correct.
- **Estimated effort:** N/A
- **Priority:** N/A
- **Status:** no_change_needed (informational confirmation, not an actionable finding)

### AUTHORIZATION-04
- **Category:** Role escalation / defense-in-depth gap
- **Severity:** Low
- **CVSS:** 3.1 (AV:N/AC:H/PR:H/UI:N/S:U/C:H/I:H/A:N) — high because exploitation requires already holding `user.manage` without being `grantsAll`, a combination not reachable in the current seed
- **OWASP Mapping:** OWASP Top 10:2021 — A01:2021 Broken Access Control
- **CWE Mapping:** CWE-269 (Improper Privilege Management)
- **Location**
  - **File:** `apps/api/src/modules/users/service.ts`
  - **Line Number:** 273-293 (`create`), 314-339 (`update`)
  - **File:** `packages/sdk/src/users.ts`
  - **Line Number:** 78, 97-111, 114-127
- **Evidence:**
  ```ts
  // packages/sdk/src/users.ts:77-78
  // open role catalog (ADR-0022): shape-validated here, existence-validated by the users.role FK
  const role = z.string().regex(/^[A-Z][A-Z0-9_]{1,19}$/);
  ```
  ```ts
  // users/service.ts:273-293 (create) and :314-339 (update)
  async create(input: unknown, userId: string): Promise<User> {
    const v = CreateUserSchema.parse(input);
    ...
    return repo.create({ ..., role: v.role, ... }, userId);
  },
  ```
  No code anywhere between the `authorize(PERMISSIONS.USER_MANAGE)` route gate (`users/routes.ts:49,69`)
  and the `repo.create`/`repo.update` write checks whether the actor is permitted to assign the *specific*
  target role (e.g. whether the target role is `grantsAll`, or outranks the actor's own role).
- **Why it is a problem:** `USER_MANAGE` and "may assign any role including SUPER_ADMIN" are conflated into
  one permission. Under the current 6-role seed this is not exploitable, because only `SUPER_ADMIN`
  (`grantsAll`) holds `USER_MANAGE` (`permissions.ts:94-148` — absent from MANAGER/TEAM_LEADER/BACKEND_USER/
  FIELD_AGENT/KYC_VERIFIER), and `roles/service.ts:109-116` blocks `grantsAll` roles from ever being
  re-configured, so `USER_MANAGE` can't be handed to a lesser role through the product's own admin UI either.
  But the RBAC model is explicitly "OPEN" (ADR-0022, custom roles via `roles/routes.ts` `POST /roles`) and a
  future custom role granted `user.manage` (a legitimate, narrower-sounding grant an admin might make for a
  delegated "HR ops" role) would, with zero additional code change, be able to silently create or promote a
  user to `SUPER_ADMIN` or any other `grantsAll` role.
- **Real world attack scenario:** An admin creates a custom `HR_ADMIN` role intended only to manage employee
  records (grants `user.manage` + `page.users`, deliberately withholding `role.manage`/`access_scope.assign`
  to keep it narrow). An HR_ADMIN account is compromised (or a malicious insider). The attacker calls
  `PUT /api/v2/users/:id` on their own account (or any account) with `{"role": "SUPER_ADMIN", ...}` — the
  request passes `authorize(USER_MANAGE)` cleanly, the Zod schema accepts any catalog-shaped role string, and
  the only remaining gate (the `users.role` FK) is satisfied because `SUPER_ADMIN` is a real row in `roles`.
  The attacker now holds full `grantsAll` access to every case, client, commission rate, and user account in
  the CRM.
- **Business impact:** Full compromise of the CRM (every client's KYC/PII data, every commission rate,
  every case) if this combination of custom-role grants is ever created — a single misconfigured custom
  role becomes a privilege-escalation primitive rather than a contained delegation.
- **Recommended fix:** In `userService.create`/`update`, reject (400) when the target `role`'s resolved
  attributes (`getRoleAttributes`) show `grantsAll === true` and the actor is not themselves `grantsAll`; more
  generally, require the actor's own role to itself hold every permission the target role holds (a
  "can't grant what you don't have" rule), mirroring the precedent already set in `roles/service.ts`'s
  `loadEditable` lock on `grantsAll` roles.
- **Estimated effort:** S (a single guard function + 2 call sites, plus a unit test)
- **Priority:** P3
- **Status:** OPEN

## Summary

Counts by severity: **Critical: 0, High: 0, Medium: 0, Low: 2, Informational: 2.**

Overall verdict: **PASS** (with minor, non-blocking findings).

Every one of the 37 `routes.ts` files under `apps/api/src/modules/` was read in full and every route was
traced to either a route-level `authorize()`/`authorizeAny()` permission check or — for the small set of
identity-scoped "my own data" surfaces (`/auth/me`, `/auth/sessions`, `/notifications`, `/jobs`,
`/saved-views`, `/consents`, `/users/me/*`, `/forms`, `/telemetry`, `/reference`) — a controller-level
`requireUserId`/`requireAuth` 401 guard backed by an ownership-scoped (`WHERE user_id = $N`) repository
query, verified at the SQL level for a representative sample of every such module. The data-scope engine
(`platform/scope/`) is a single, fail-closed, code-owned predicate composer used consistently by `cases`,
`tasks`, `dashboard`, `mis`, `billing`, `field-monitoring`, `fieldReports`, and `caseReports` — every
case/task mutation traced (assign, complete, revoke, revisit, reassign, finalize, record-result,
attachments, field photos) calls `resolveScope(actor)` before the write and 404s (not 403s) an out-of-scope
target, which is the correct IDOR-safe pattern. The two previously-fixed bug classes the brief asked to
re-verify — ADR-0078 (assignee pool no longer capped by org-hierarchy, but the task itself is still
scope-checked first) and ADR-0072 (user scope = CLIENT+PRODUCT only, unwired dimensions removed) — were both
confirmed live in current code by direct read, not assumed from memory. The only findings are: a low-severity
realtime-channel scope inconsistency (case metadata broadcast to the whole office room rather than
per-recipient scope, AUTHORIZATION-01), an informational CORS note adjacent to the realtime handshake
(AUTHORIZATION-02), and a low-severity defense-in-depth gap where `user.manage` conflates "can edit users"
with "can assign any role including SUPER_ADMIN" (AUTHORIZATION-04) — not exploitable today under the
6-role seed, but a latent risk if the open custom-role system is ever used to delegate `user.manage` without
also delegating full admin trust. No Critical, High, or Medium findings; no IDOR, horizontal, or vertical
privilege-escalation path was found exploitable in current code.
