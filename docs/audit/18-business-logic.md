# AUDIT 18: Business Logic

## Scope

Read-only static inspection of the CRM2 API's core business-logic surfaces:

- **Case → Task → Verification-Unit lifecycle**: `apps/api/src/modules/cases/{service,repository,controller,routes}.ts`, `apps/api/src/modules/tasks/{service,repository,controller,routes}.ts`, `apps/api/src/modules/verification-tasks/{service,routes}.ts`
- **Assignment / assignee-pool logic** (ADR-0024/0055/0078): the eligibility functions in `cases/repository.ts` and `tasks/repository.ts`, `platform/scope/repository.ts` (`getScopedUserIds`, `resolveScope`)
- **Permissions / RBAC**: `packages/access/src/permissions.ts`, `apps/api/src/platform/access/{repository,index}.ts`, role-permission seed migrations `db/v2/migrations/0033_roles.sql`, `0040_dedupe_company_and_perm.sql`, `0052_case_lifecycle.sql`, `0085_complete_finalize_manager_tl.sql`
- **Case finalize / verdict** (ADR-0032/0033/0050): `cases/service.ts` `finalizeCase`, `cases/repository.ts` `finalizeCase`/`caseFinalizeState`
- **FIELD_REPORT snapshot freeze** (ADR-0080): `apps/api/src/modules/fieldReports/{service,repository}.ts`
- **CASE_REPORT engine** (ADR-0041): `apps/api/src/modules/caseReports/{service,job,repository}.ts`
- **File/attachment/photo downloads**: `cases/service.ts` (`listAttachments`, `attachmentUrl`, `deleteAttachment`, `fieldPhotoDownload`, `fieldPhotosZip`)
- **Bulk export/import infra**: `apps/api/src/platform/export/{index,job}.ts`, `apps/api/src/platform/import/index.ts`, `packages/config/src/index.ts` (env caps), `apps/api/src/http/registerJobs.ts`
- **Background job tray / IDOR**: `apps/api/src/modules/jobs/{service,routes}.ts`
- **Other scope-consumers checked for the ADR-0078 bug class**: `apps/api/src/modules/field-monitoring/{service,repository}.ts`, `apps/api/src/modules/dashboard/repository.ts`, `apps/api/src/modules/mis/*`
- **Dedupe cross-client search**: `cases/repository.ts` (`searchDuplicates`, `searchDuplicatesPaged`), `cases/routes.ts`

Commands actually run (read-only `grep`/`find`/`wc`/`sed`/`cat` throughout; no installs, no DB/network connections, no file writes other than this report):
- `grep -rn "getScopedUserIds|eligibleAssignee|assigneePool" apps/api/src --include=*.ts`
- `grep -rn "CASE_FINALIZE" packages/access/src/permissions.ts`
- `grep -rln "case.finalize" db/v2/migrations`
- `grep -n "case.finalize" -B2 -A2 db/v2/migrations/0052_case_lifecycle.sql`
- `grep -rn "assignableUsers|assignable-users" apps/web/src --include=*.ts --include=*.tsx`
- `grep -rln "getScopedUserIds" apps/api/src/modules --include=*.ts`
- `grep -n "VALID_TRANSITIONS|INVALID_TRANSITION" apps/api/src/modules/cases/repository.ts`
- `grep -rn "EXPORT_JOB_MAX_ROWS|IMPORT_JOB_MAX_ROWS" apps/api/src packages --include=*.ts`
- `grep -n "registerExportBuilder" apps/api/src --include=*.ts`
- `grep -n "'data.export'|'dedupe.view'" db/v2/migrations/*.sql`

## Checklist Results

| Item | Verdict | Evidence | Notes |
|---|---|---|---|
| Case workflow (state machine integrity) | PASS | `cases/repository.ts:1072-1109` (`finalizeCase`: OCC version + `status='AWAITING_COMPLETION'` guard in one UPDATE, audit row in same tx); `cases/repository.ts:1095,1135,1397,1425,1469,1514` (every transition site throws `INVALID_TRANSITION` on a 0-row CASE-guarded UPDATE) | Every status transition is DB-level CAS (compare-and-set) on `status` + `version`, never a blind write. |
| Assignment — eligibility pool (ADR-0078) | PARTIAL (see BUSINESS_LOGIC-01) | `tasks/repository.ts:279-309` and `cases/repository.ts:851-879` correctly implement "no org-hierarchy cap, territory/unit grant is the access control"; BUT `cases/repository.ts:830-838` (`assignableUsers`, the no-`taskId` branch reached via `cases/service.ts:451`) still calls `getScopedUserIds(actor)` — the pre-ADR-0078 org-hierarchy cap | Live route `GET /cases/:id/assignable-users` (no `?taskId=`) still serves the old, narrower pool. No first-party web/SDK caller uses this branch today (`apps/web/src/features/pipeline/PipelinePage.tsx:297` uses the fixed `tasks/assignable-users?taskIds=` endpoint instead) — confirmed via `grep -rn "assignableUsers|assignable-users" apps/web/src`, only one hit, on the tasks endpoint. |
| Assignment — revoke-before-reassign (ADR-0055) | PASS | `cases/service.ts:464-473` (`assignTask` requires `state.status === 'PENDING'`, else `TASK_NOT_ASSIGNABLE`); `cases/repository.ts:1446-1478` (`revokeTaskInPlace`: only `{ASSIGNED,IN_PROGRESS}→REVOKED`); `cases/repository.ts:1251-1346` (`reassignRevokedTask` requires the parent task `status='REVOKED'`, `cases/service.ts:593`) | No code path re-points a live ASSIGNED task in place; every reassignment is revoke-then-reassign, each step audited. |
| Assignment — bulk assign | PASS | `tasks/service.ts:242-308` (`bulkAssign`: per-row scope-visibility check via `tasksForAssignment`, `status==='PENDING'` check, `eligibleTaskIdsForAssignee` ADR-0078 eligibility check, OCC-guarded `caseRepository.assignTask` write, per-row error containment — a real failure is never swallowed) | Reuses the single-assign write path so audit/history/notifications ride free. |
| Assignment-pool bug class in OTHER modules (field-monitoring/dashboard/MIS) | PASS | `grep -rln "getScopedUserIds" apps/api/src/modules` → only `cases/repository.ts` (flagged above) and `field-monitoring/{service,repository}.ts`; `field-monitoring/service.ts:63,69,88,103,127` documents itself as a supervisor "watch my team" hierarchy-scoped READ view, not an assignment pool; `dashboard/repository.ts:72-84` and MIS use `assignment_pool_roles`/`resolveScope` correctly, no pool-eligibility duplication found | `getScopedUserIds`/`resolveScope` is the correct primitive for case/task **visibility** (who can see whose rows); ADR-0078 specifically targeted **assignee-pool eligibility** (who can be assigned a task), a different concern. No other module conflates the two. |
| Status changes — OCC / concurrency | PASS | `cases/repository.ts:1072-1109` (finalize), `:1115-1151` (recordTaskResult), `:912+` (assignTask) — every write site takes `expectedVersion`, UPDATEs `WHERE version = $n`, and on a 0-row result re-reads to distinguish `INVALID_TRANSITION` from `STALE_UPDATE` (409) | Consistent OCC pattern across the module; matches the documented CONCURRENCY standard referenced in comments. |
| Approval flow — case.finalize permission scope (ADR-0032/0050) | PASS | `packages/access/src/permissions.ts:103,123,137` (MANAGER/TEAM_LEADER/BACKEND_USER all hold `CASE_FINALIZE`; SUPER_ADMIN via `grants_all`); `db/v2/migrations/0052_case_lifecycle.sql:50-54` (`BACKEND_USER` granted `case.finalize` at the DB level); `db/v2/migrations/0085_complete_finalize_manager_tl.sql:10-15` (`MANAGER`/`TEAM_LEADER` added, `KYC_VERIFIER` explicitly excluded with rationale "stays the read-only relay role") | Runtime DB grants (`role_permissions`) match the in-code `ROLE_PERMISSIONS` parity-reference exactly for `case.finalize`. `FIELD_AGENT` and `KYC_VERIFIER` correctly excluded. |
| Approval flow — desk task-complete vs case-finalize separation | PASS | `cases/routes.ts:43,47` gate task-level `complete`/`record-result` on `FIELD_REVIEW_COMPLETE`; `cases/routes.ts:61` gates the case-level `finalize` separately on `CASE_FINALIZE` | A user who can complete individual tasks cannot, by that grant alone, finalize the case's one official verdict — both permissions are held by the same 4 roles today (by design) but are independently gated, not conflated in code. |
| Report generation — FIELD_REPORT snapshot tamper-resistance (ADR-0080) | PASS | `fieldReports/service.ts:88-101` (read returns `repo.findSnapshot(taskId)` FIRST, live-render only as fallback when `!snap`); `grep -rn "fieldReportService.snapshot" apps/api/src` → exactly one call site, `verification-tasks/service.ts:186`, inside `submitForm` (the device's one-shot submit==complete path) | No admin/report-layout-edit code path re-invokes `snapshot()`, so a later template change cannot rewrite an already-frozen narrative. A resubmit (same task) does refresh its OWN snapshot — documented, intended idempotent-resubmit behavior, not a tamper vector by a different actor. |
| Report generation — read path consistency (snapshot vs live render) | PASS | `fieldReports/service.ts:90-113` — single `render()` function used by every caller; no second/duplicate render path found via `grep -rn "resolveNarrative\|FIELD_REPORT_DEFAULTS" apps/api/src/modules` (only referenced inside `fieldReports/service.ts`) | One read path; cannot be bypassed to get a live re-render of an already-snapshotted task. |
| Report generation — CASE_REPORT IDOR + worker re-scope | PASS | `caseReports/service.ts:58-64` (`enqueueReport` 404s on `!caseVisible` before enqueueing); `caseReports/job.ts:19-20,30-34` ("the worker re-resolves the SAME scope" — `caseReportService.assemble(caseId, actor)` re-derives scope from the payload's `actor.role`/`userId`, not a cached permission snapshot) | Mitigates a permission-revoked-between-enqueue-and-render race; the worker doesn't blindly trust a stale payload. |
| File downloads — attachment/photo IDOR (case-scope + task-scope) | PASS | `cases/service.ts:766-775` (`attachmentUrl`: case-visibility gate THEN `attachmentForAccess` re-check, with inline comment citing a prior real bug "A2026-0623-06" where a case-level doc bypassed scope via the `task_id IS NULL` leg alone — now fixed); `:677-689` (`fieldPhotoDownload`: scoped via `listFieldPhotoFiles(caseId, scope)` then `.find(id)`, 404 if absent); `fieldReports/repository.ts:31-43` (`taskScopePredicate`: task-GRAIN, not case-grain, specifically to stop a field agent assigned a sibling task in the same case from reading another agent's report — documented IDOR fix "A2026-0623-09") | Multiple independently-documented historical IDOR fixes (A2026-0623-06, -09) are present and consistent in the CURRENT code; not stale references to fixed-then-regressed bugs — verified by reading the actual guard logic, not just the comments. |
| File downloads — background job result URLs | PASS | `jobs/service.ts:35-51` (`get`/`resultUrl` both call `jobRepository.getOwned(id, userId)` — every job read is filtered `created_by = actor` at the SQL layer, non-owner → null → 404); `jobs/routes.ts:5-7` ("No permission gate... scope is identity... :id 404s for a non-owner") | Own-user identity scoping, not just a permission check — correctly IDOR-safe for export/import/case-report artifacts that flow through the shared jobs tray. |
| Bulk exports — row cap enforced server-side | PASS | `packages/config/src/index.ts:60,67` (`EXPORT_JOB_THRESHOLD` default 10000, `EXPORT_JOB_MAX_ROWS` default 200000, both `z.coerce.number().int().positive()` — env-driven, not client-controllable); `platform/export/index.ts:51-60` (`assertExportable` throws 413 `EXPORT_TOO_LARGE` server-side on the SCOPED total count); `platform/export/job.ts:60` (`exportJobRowCap()` reads the same env var, applied inside the job processor at `:76-92`, surfaces `capped: true` rather than silently truncating) | Both the sync-export 413 ceiling and the background-job hard ceiling are real, non-bypassable server checks (not just declared in env schema — actually called at the guard sites). |
| Bulk exports — scope parity with the underlying list endpoint | PASS | `cases/service.ts:373-403` (`list`) vs `:405-438` (`exportData`) — byte-for-byte the same `resolveScope(actor)` → `repo.list({...scope...})` call shape, same filters, same `assertExportable(totalCount)` gate on the SCOPED count (not the unscoped count, so a 413 can't leak out-of-scope row existence per the inline comment at `:407-410`) | Verified by direct side-by-side read of both functions; export cannot return rows the list endpoint would hide. |
| Bulk exports — async (job-tier) builder scope | PASS (narrow) | `http/registerJobs.ts:33-38` — only `locations` (a global reference catalog, not client/case PII) is registered via `registerExportBuilder`; `grep -rn "registerExportBuilder" apps/api/src` confirms no second call site | The async export-job tier's `ExportBuild` signature passes only `actorId` (not a full `Actor`/role) to the builder (`export/job.ts:43-48`), which would be a real re-scoping risk if a case/billing resource were registered for it — today none is, so the gap is latent, not live. Documented in Findings (informational) for forward-looking awareness, not a current FAIL. |
| Bulk imports — row cap enforced server-side | PASS | `packages/config/src/index.ts:69,71` (`IMPORT_JOB_THRESHOLD` 10000, `IMPORT_JOB_MAX_ROWS` 200000); `platform/import/index.ts:322-330` (`importConfirmOrEnqueue`: `assertImportable(count, importMaxRows())` called BEFORE any row is processed or enqueued, rejects with 413 `IMPORT_TOO_LARGE`) | Confirmed wired at the actual confirm/enqueue decision point, not just declared. |
| Cross-client access — case/task/attachment scope | PASS | `platform/scope/repository.ts:36-59,94-120` (`getScopedUserIds`/`resolveScope`: hierarchy mode + EXPAND/RESTRICT dimension wiring, unknown role fail-closes to `SELF` + no dimensions); every read path checked above (`caseVisible`, `taskScopePredicate`, `attachmentForAccess`) composes this scope, not a client-supplied filter | Consistent scope-predicate composition pattern (`composeScopePredicate`) used throughout; no module found constructing its own bespoke, unscoped client/case filter. |
| Cross-client access — dedupe (intentional cross-client exception) | PASS | `cases/repository.ts:398-400` ("Cross-scope BY DESIGN (a duplicate must be findable anywhere) — gated by `dedupe.view`, not case.view"); `:347-368` (`dedupeConditions`: exact-match only on PAN/mobile/name/company, no browse/list-all path); `packages/access/src/permissions.ts:53,106,124,135` (`DEDUPE_VIEW` granted to MANAGER/TEAM_LEADER/BACKEND_USER, NOT FIELD_AGENT/KYC_VERIFIER) | A deliberate, documented, narrowly-gated fraud-prevention exception (exact-identifier match, capped at 200 rows, dedicated permission) — not an accidental leak. Verified the SQL only supports exact `=`/`upper()=`/`lower()=` matches, no `LIKE`/wildcard browse. |
| Cross-client access — dedupe EXPORT permission gate | FAIL (see BUSINESS_LOGIC-02) | `cases/routes.ts:16` (`GET /dedupe-search/export` gated `PERMISSIONS.DATA_EXPORT`, NOT `PERMISSIONS.DEDUPE_VIEW`) vs `:17` (`GET /dedupe-search` correctly gated `DEDUPE_VIEW`) | Currently every role holding `DATA_EXPORT` also holds `DEDUPE_VIEW` (verified `db/v2/migrations/0033_roles.sql:65-73` vs `0040_dedupe_company_and_perm.sql:19-21` — identical role sets MANAGER/TEAM_LEADER/BACKEND_USER), so NOT exploitable today, but the export route checks the wrong permission — a config-only drift (granting `data.export` to a new/different role without `dedupe.view`) would let it export cross-client PII it can't even view on-screen. |
| Permission inheritance — role/permission resolution freshness | PASS | `platform/access/index.ts:11-26` (5s in-process cache, `invalidateRoleCache()` called by the roles service after any config write — explicit bust-on-write, same pattern as the documented `tokens_valid_after` revoke cache) | Permission changes take effect promptly; no stale-grant window beyond the 5s TTL on processes that didn't receive the explicit invalidation (single-instance prod per architecture-inventory, so this is moot in practice). |
| Permission inheritance — grants_all / hierarchy bleed | PASS | `packages/access/src/authorize.ts:30,50` (`auth.grantsAll !== true && !auth.permissions?.includes(perm)` — `grantsAll` is the ONLY bypass, reserved for `SUPER_ADMIN`); `platform/access/repository.ts:47` (`if (role.grantsAll) return {grantsAll:true, permissions:[], ...}` else explicit `role_permissions` table lookup) | No implicit role-hierarchy permission bleed (e.g. MANAGER does NOT implicitly inherit everything BACKEND_USER has) — every non-SUPER_ADMIN role's permission set is the literal `role_permissions` rows, nothing computed/inherited. |

## Findings

### BUSINESS_LOGIC-01
- **Category:** Business Logic / Authorization (stale assignment-pool logic, ADR-0078 incomplete rollout)
- **Severity:** Low
- **CVSS:** 3.1 (AV:N/AC:L/PR:H/UI:N/S:U/C:N/I:L/A:N) — N/A precise scoring difficult; this is an availability/under-provisioning defect, not a confidentiality leak
- **OWASP Mapping:** A01:2021 – Broken Access Control (inconsistent enforcement, not a leak)
- **CWE Mapping:** CWE-841 (Improper Enforcement of Behavioral Workflow) / CWE-1220 (Insufficient Granularity of Access Control, partially fixed)
- **Location**
  - **File:** `apps/api/src/modules/cases/repository.ts`
  - **Line Number:** 830-838 (`assignableUsers`), reached via `apps/api/src/modules/cases/service.ts:450-451`, route `apps/api/src/modules/cases/routes.ts:62`
- **Evidence:**
  ```ts
  // cases/repository.ts:830-838
  async assignableUsers(actor: Actor): Promise<AssignableUser[]> {
    const base = `SELECT id, username, name, role FROM users
                  WHERE is_active AND effective_from <= now()
                    AND role IN (SELECT DISTINCT worker_role FROM verification_units WHERE is_active)`;
    const ids = await getScopedUserIds(actor);
    if (ids === undefined) return query<AssignableUser>(`${base} ORDER BY name`, []);
    return query<AssignableUser>(`${base} AND id = ANY($1::uuid[]) ORDER BY name`, [ids]);
  },
  ```
  ```ts
  // cases/service.ts:450-451
  async assignableUsers(actor: Actor, taskId?: string, visitType = 'FIELD'): Promise<AssignableUser[]> {
    if (taskId === undefined) return repo.assignableUsers(actor);
  ```
  vs. the ADR-0078-fixed sibling, `cases/repository.ts:851-879` (`eligibleAssigneesForNew`), which uses `user_scope_assignments`/`user_kyc_unit_access` territory/unit grants instead of `getScopedUserIds`.
- **Why it is a problem:** ADR-0078 ("assignee pool = territory/unit grant, NOT org-hierarchy") was applied to `tasks/repository.ts` (`eligibleAssignees`, `eligibleTaskIdsForAssignee`) and `cases/repository.ts` (`eligibleAssigneesForNew`), but the older `assignableUsers` function — reachable from the live `GET /cases/:id/assignable-users` route when called WITHOUT a `taskId` query param — was not updated and still caps the pool by the calling actor's org-hierarchy subtree (`getScopedUserIds`). This is the exact bug class ADR-0078 was written to eliminate: a SELF-hierarchy `case.assign` holder (e.g. a BACKEND_USER) calling this branch gets an empty or under-populated assignee pool even though territory/unit grants are the documented access control for who can work a task.
- **Real world attack scenario:** Not an attacker-facing exploit (this under-provisions rather than over-exposes), but a genuine business-logic correctness bug: a BACKEND_USER or TEAM_LEADER with `case.assign` who triggers this code path (directly via API, or if a future web feature reintroduces a no-`taskId` call) would see zero or too few field/KYC executives in the assignment picker, even though those executives hold the correct territory/unit grant and are properly assignable via every other path in the app (Pipeline page, single-task assign, reassign, bulk-assign all use the FIXED functions). This reproduces the original bug ADR-0078 was opened to fix (empty field-exec pool for SELF-hierarchy holders), just on an unused-by-web branch.
- **Business impact:** Low today because no first-party client (web, and per project memory mobile is not a `case.assign` holder) calls this branch — confirmed by `grep` showing the SDK method `s.cases.assignableUsers(caseId)` (no taskId) is never invoked from `apps/web/src`. But it is a live, authorized, undocumented-as-deprecated API surface; any future FE work, a third-party integration, or direct API use by an ops/support engineer would silently regress to the pre-ADR-0078 bug.
- **Recommended fix:** Either (a) delete the `taskId === undefined` branch and the underlying `repo.assignableUsers` function entirely if it's dead/legacy (confirm with web team there's no other consumer), or (b) make it call the same territory/unit-grant eligibility model as `eligibleAssigneesForNew`/`eligibleAssignees` for parity. Given CLAUDE.md's "reuse, never reinvent" rule, option (a) — delete the unused legacy path — is the lazy/correct fix if truly dead.
- **Estimated effort:** S (1-2 hours: confirm zero external/mobile consumers, then delete the branch + function + route param, or align it to the territory model)
- **Priority:** P3
- **Status:** OPEN

### BUSINESS_LOGIC-02
- **Category:** Business Logic / Authorization (permission-gate mismatch on a cross-client PII export route)
- **Severity:** Low
- **CVSS:** 4.3 (AV:N/AC:L/PR:H/UI:N/S:U/C:L/I:N/A:N) — contingent on future role/permission config drift; not currently exploitable
- **OWASP Mapping:** A01:2021 – Broken Access Control
- **CWE Mapping:** CWE-863 (Incorrect Authorization)
- **Location**
  - **File:** `apps/api/src/modules/cases/routes.ts`
  - **Line Number:** 16
- **Evidence:**
  ```ts
  // cases/routes.ts:13-17
  caseRoutes.post('/dedupe', authorize(PERMISSIONS.CASE_VIEW), c.dedupe);
  // Standalone Dedupe Check page — dedicated read-only perm (NOT case.view; scans ALL cases).
  // Static paths declared before /:id; the /export path before its bare sibling.
  caseRoutes.get('/dedupe-search/export', authorize(PERMISSIONS.DATA_EXPORT), c.dedupeSearchExport);
  caseRoutes.get('/dedupe-search', authorize(PERMISSIONS.DEDUPE_VIEW), c.dedupeSearch);
  ```
  Compare to the codebase's OWN documented awareness of this exact bug class for billing, `billing/routes.ts:12-15`:
  ```ts
  // Gated `billing.view` (NOT just data.export): the export carries the SAME sensitive bill+commission
  // amounts as the list, so it must share the list's audience — otherwise a data.export-only role
  // (TEAM_LEADER) blocked from /cases could exfiltrate the amounts via export (Security/CEO panel BLOCK).
  billingRoutes.get('/cases/export', authorize(PERMISSIONS.BILLING_VIEW), c.export);
  ```
- **Why it is a problem:** The dedupe-search VIEW endpoint (`/dedupe-search`) is correctly gated on the dedicated, narrowly-granted `dedupe.view` permission (explicitly NOT `case.view`, per the inline comment, because dedupe intentionally scans cross-client/cross-case data). But the EXPORT of that exact same cross-client data set (`/dedupe-search/export`) is gated only on the generic `data.export` permission — the same class of bug the codebase's own `billing/routes.ts` comment explicitly calls out and fixes for billing exports. Today the two permissions happen to be granted to an identical role set (MANAGER, TEAM_LEADER, BACKEND_USER — verified in both `db/v2/migrations/0033_roles.sql:65-73` and `0040_dedupe_company_and_perm.sql:19-21`), so there is no live privilege escalation. But the route's authorization check is logically wrong/inconsistent with its sibling, and the codebase's own established pattern (see billing) is to gate an export on the SAME permission as the underlying view, not the generic export flag.
- **Real world attack scenario:** If an admin ever grants `data.export` to a new or existing role (e.g. a future "Data Entry" or "Analyst" role that needs to export case lists but should NOT see cross-client dedupe matches) without separately granting `dedupe.view`, that role could call `GET /api/v2/cases/dedupe-search/export?pan=...` directly and exfiltrate cross-client applicant PII (name, mobile, PAN, company, which client/case) it cannot see via the UI's Dedupe Check page (blocked by missing `dedupe.view`) or via any other case-view route (blocked by case-scope). This is a config-only escalation, not a code exploit — but it is the exact failure mode the project's own ADR-comment history (billing) already flags as a real risk class for this codebase.
- **Business impact:** Currently zero (no role has the mismatched grant). Latent risk: a future RBAC config change made without re-deriving from this audit could silently open a cross-client PII export. PAN/mobile/company exposure across clients is a meaningful KYC/compliance concern (this is a verification CRM where client-data segregation is presumably a contractual expectation).
- **Recommended fix:** Change `cases/routes.ts:16` from `authorize(PERMISSIONS.DATA_EXPORT)` to `authorize(PERMISSIONS.DEDUPE_VIEW)`, mirroring the `billing/routes.ts:16` pattern exactly. One-line change; no migration needed since the role grants already coincide.
- **Estimated effort:** S (15 minutes: one-line route change + a regression test asserting a `dedupe.view`-less, `data.export`-holding role gets 403)
- **Priority:** P2
- **Status:** OPEN

### BUSINESS_LOGIC-03
- **Category:** Business Logic / Forward-looking design gap (background export-job re-scoping)
- **Severity:** Informational
- **CVSS:** N/A — no current call site exercises this path with scope-sensitive data
- **OWASP Mapping:** N/A
- **CWE Mapping:** CWE-863 (Incorrect Authorization) — latent, not present
- **Location**
  - **File:** `apps/api/src/platform/export/job.ts`
  - **Line Number:** 43-48, 71-76
- **Evidence:**
  ```ts
  // export/job.ts:43-48
  export type ExportBuild = (
    query: Record<string, unknown>,
    actorId: string,
    cols: string[],
    format: ExportFormat,
  ) => Promise<{ body: Buffer; filename: string; rowCount: number; totalCount?: number }>;
  ```
  The processor (`:71-76`) calls `build(p.query, p.actorId, p.cols, p.format)` — only a bare `actorId` string is threaded through, not a resolved `Actor`/role or a pre-computed `Scope`. Currently the only registered builder is `locations` (`http/registerJobs.ts:33-38`), a global reference catalog with no client/case scope to enforce, so this is a non-issue today.
- **Why it is a problem:** If a future module (e.g. cases or billing) registers an async export builder for its scope-sensitive data, the builder's signature gives it only an `actorId`, not the actor's role/hierarchy — it would have to re-fetch the user's role itself to call `resolveScope`. This is a foot-gun: it's easy for a future implementer to build a query directly from `p.query` (the raw client-supplied filters) without re-deriving `resolveScope(actor)`, since the signature doesn't make the scope a required input the way `caseReportJobProcessor` does (`caseReports/job.ts:31,34` passes the FULL `actor` object through its job payload and re-resolves scope, which is the correct pattern already proven elsewhere in this same codebase).
- **Real world attack scenario:** Hypothetical/forward-looking only: a future cases/billing async export builder that doesn't re-derive scope from a resolved role could let an export job, once enqueued under the synchronous endpoint's 413 fallback (`export/job.ts:124-128`), produce a file containing rows beyond the actor's territory/hierarchy scope, with the user later downloading it via the IDOR-safe-by-identity `jobs/:id/result-url` (which only checks job OWNERSHIP, not whether the artifact's CONTENTS were correctly scoped at build time).
- **Business impact:** None today (zero scope-sensitive builders registered). Recorded so the next engineer who registers a cases/billing/MIS async export builder follows the `caseReportJobProcessor` pattern (pass + re-resolve the full `Actor`) rather than the looser `ExportBuild` signature as currently typed.
- **Recommended fix:** When a scope-sensitive resource adopts the async export tier, change its registration to thread the full `Actor` (or a server-resolved `Scope`) through the payload and re-call `resolveScope` inside the builder, mirroring `caseReports/job.ts:30-34`. Optionally widen `ExportBuild`'s second parameter from `actorId: string` to `actor: Actor` now, even before a second builder is registered, to make the safe pattern the path of least resistance.
- **Estimated effort:** S (when needed) — type signature change + one re-resolve call per future builder; do this AT THE TIME a scope-sensitive builder is added, not preemptively (YAGNI — `locations` doesn't need it).
- **Priority:** P3
- **Status:** OPEN

## Summary

- **Critical:** 0
- **High:** 0
- **Medium:** 0
- **Low:** 2 (BUSINESS_LOGIC-01, BUSINESS_LOGIC-02)
- **Informational:** 1 (BUSINESS_LOGIC-03)

**Overall verdict: PARTIAL.** Every checklist item beyond the two Low findings is a real, evidenced PASS: the case/task/verification-unit state machine is OCC-guarded and transition-checked throughout; `case.finalize` is correctly restricted to BACKEND_USER/SUPER_ADMIN/MANAGER/TEAM_LEADER at both the code-constant and the live `role_permissions` table; revoke-before-reassign (ADR-0055) has no in-place-reassign path anywhere in the codebase; the FIELD_REPORT snapshot (ADR-0080) is genuinely immutable post-submission (single write call site, snapshot-first read); file/attachment/photo downloads are consistently scope- and ownership-guarded with multiple documented historical IDOR fixes still correctly in place; and bulk export/import row caps are real, server-enforced, non-bypassable limits that respect the same row-level scoping as their underlying list endpoints. The two Low findings are both **inconsistency** bugs rather than live exploits: a legacy assignee-pool function (`cases/repository.ts:assignableUsers`) that ADR-0078's fix never reached, confirmed unreachable from any first-party client today; and a dedupe-export route gated on the wrong (broader-named, currently-coincident) permission, which the codebase's own `billing/routes.ts` comment shows the team already knows to avoid — recommend applying that exact known-good pattern here too.
