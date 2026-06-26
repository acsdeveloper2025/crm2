# Plan — KYC-unit assignment eligibility (ADR-0073, mig 0100)

**Owner-directed 2026-06-26, design re-confirmed via AskUserQuestion** (the owner corrected this twice). A
KYC verifier is granted specific KYC units; an OFFICE task is assignable only to KYC users granted that task's
unit. This is **assignment-eligibility**, NOT scope-visibility — **KYC visibility stays SELF**.

Locked decisions: (1) a **new eligibility-only table** (the visibility resolver never reads it); (2) **required
grant model** (no grant ⇒ not assignable for that unit); (3) **no** CLIENT/PRODUCT scope for KYC (stays SELF);
(4) mig 0100 **backfills** all existing KYC verifiers × all active verification units (no deploy disruption;
admins prune). **CORRECTION (owner, 2026-06-26): a KYC verifier is grantable ANY active verification unit —
field OR office, not just KYC units** (a KYC verifier can be OFFICE-assigned a task at any unit, ADR-0070).

Branch `feat/kyc-unit-access` off origin/main `0e07e03` (ITEMS 1+2). Next free: **ADR-0073, mig 0100**.

## Data
`db/v2/migrations/0100_user_kyc_unit_access.sql`:
```sql
CREATE TABLE user_kyc_unit_access (
  id integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  verification_unit_id integer NOT NULL REFERENCES verification_units(id),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_kyc_unit UNIQUE (user_id, verification_unit_id)
);
CREATE INDEX idx_ukua_user ON user_kyc_unit_access (user_id) WHERE is_active;
-- backfill: every KYC verifier × every active unit (preserve today's open OFFICE pool); role data-driven
INSERT INTO user_kyc_unit_access (user_id, verification_unit_id)
SELECT u.id, vu.id FROM users u CROSS JOIN verification_units vu
 WHERE u.role = (SELECT role_code FROM assignment_pool_roles WHERE visit_type = 'OFFICE') AND vu.is_active
ON CONFLICT (user_id, verification_unit_id) DO NOTHING;
```
CREATE TABLE on a NEW table + INSERT…SELECT (reads users/verification_units = ACCESS SHARE) → no hot-table
ACCESS EXCLUSIVE, no rolling-deploy hang → no lock-retry preamble. Idempotent (`ON CONFLICT`, `IF NOT EXISTS`).

## Eligibility (the security crux — TDD first)
Three OFFICE-pool functions gain "the assignee holds an active grant for the task's unit". The write paths
(`cases/service.ts` create-assign INVALID_ASSIGNEE, reassign, bulk) re-validate through these → fail-closed.
- `cases/repository.ts eligibleAssigneesForNew(visitType, pincodeId, areaId, scopeUserIds)` → add a
  `verificationUnitId` param; OFFICE leg: `EXISTS(grant for verificationUnitId)` (was: OFFICE skipped). Thread
  `t.verificationUnitId` from `cases/service.ts:307` + the `eligibleAssignees` controller.
- `tasks/repository.ts eligibleAssignees(taskIds, visitType, scopeUserIds)` → extend the per-task `NOT EXISTS`
  so OFFICE requires a grant for `t.verification_unit_id`.
- `tasks/repository.ts eligibleTaskIdsForAssignee(taskIds, assigneeId, visitType, scopeUserIds)` → same OFFICE leg.

## Grant API + admin UI
Minimal dedicated module `userKycUnits` (repository + service + controller), mounted under `/users/:id`:
- `GET /users/:id/kyc-units` → the user's granted unit ids (+ available KYC units for the picker). `page.users`.
- `PUT /users/:id/kyc-units { unitIds: number[] }` → set-the-set (activate listed, deactivate the rest), audited.
- SDK `packages/sdk/src/userKycUnits.ts`: `SetKycUnitsSchema = { unitIds: z.array(positiveInt) }` + view type.
- Web: a grant editor in the user dialog (`UserDialog`/`UserAccessSection` area), shown only for KYC_VERIFIER
  users — a checkbox list of active KYC units; one Save → PUT. Non-KYC users don't see it.

## Visibility — UNCHANGED
No resolver/scope change. KYC verifiers stay SELF. The grant table is read ONLY by the 3 eligibility functions.

## TDD
1. eligibility (api test, the crux): grant a KYC user unit A; an OFFICE task at unit A → the user is in the
   eligible pool AND assign succeeds; an OFFICE task at unit B (no grant) → user NOT in pool AND assign →
   400 INVALID_ASSIGNEE. Cover all 3 functions (new-task add-assign, pipeline assignable, bulk per-row).
2. grant CRUD: PUT sets the set (add/remove), GET returns it; non-KYC user PUT → 400/empty; perm-gated (403/401).
3. visibility invariant: a KYC user granted unit A still sees ONLY tasks assigned to them (SELF) — granting a
   unit does NOT widen what they see. (Adversarial: prove the grant never reaches the visibility resolver.)

## Verify
Full `pnpm verify` GREEN. Apply 0100 to crm2_dev; browser-verify: grant/revoke a KYC unit for a KYC user in
the user dialog; an OFFICE task's assignee picker shows only granted KYC users. Adversarial security review:
fail-closed at the write, no visibility widening, grant is eligibility-only.
