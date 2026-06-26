# Plan — User access scope = CLIENT + PRODUCT (remove the 3 unwired dimensions) — ADR-0072

**Owner-directed 2026-06-26** (chose "remove the 3 unwired dims" via AskUserQuestion). Reduce the user-access
scope catalog to the dimensions that are actually wired: **CLIENT, PRODUCT** (+ **PINCODE, AREA** = field-agent
territory, KEPT — removing them would change field-agent visibility). Remove **STATE, CITY, VERIFICATION_TYPE**
— they are selectable in the catalog but wired to **no system role** (COMPLIANCE SR-10), so **zero access change**.

Branch `feat/scope-client-product` off origin/main (`a761a93`, includes ITEM 1). Next free: **ADR-0072, mig 0099**.

## Security — zero widening (verified)
A `user_scope_assignment` can only be created for a dimension **wired to the user's role** (the add/import path
validates against `role_scope_dimensions` + `dimensionDef`). These 3 are wired to no role → **no active user
assignment can exist** for them (confirmed: 0 in crm2_dev; structurally guaranteed). Removing them therefore
drops no restriction from anyone. Every scope reader (resolver `composeScopePredicate`, role-dimension feed,
assignment list/export, role-editor catalog) filters `is_active`, so deactivating the catalog rows cleanly
removes them everywhere. `scope_dimensions` rows are **deactivated (is_active=false), not deleted** — audit trail
preserved, re-activatable.

## Files
- **code** `apps/api/src/platform/scope/dimensions.ts`: drop `STATE | CITY | VERIFICATION_TYPE` from the
  `DimensionCode` union and the `DIMENSIONS` record. (VERIFICATION_TYPE is the ONLY dim with a `taskPredicate`;
  the `taskPredicate?` field + the `def.taskPredicate ?? def.casePredicate` consumer stay — harmless extension
  point, now unused.) SDK unchanged (`code` is `z.string()`, not an enum — non-breaking).
- **db** `db/v2/migrations/0099_deactivate_unused_scope_dimensions.sql`: idempotent UPDATEs setting
  `is_active=false` on the 3 in `scope_dimensions`, and defensively on any `role_scope_dimensions` /
  `user_scope_assignments` for them (0 expected). UPDATE-only (no DDL) → no rolling-deploy lock risk, no preamble.
- **web** `apps/web/src/components/UserAccessSection.tsx`: drop CITY/STATE from `FOLDED_LOCATION_DIMS` (now dead)
  + fix the stale comment. RoleRecordPage + the catalog feed are data-driven → auto-drop the 3.
- **docs** ADR-0072 (amends ADR-0022) + `docs/COMPLIANCE_GAPS_REGISTRY.md` SR-8/SR-10 → FIXED.

## TDD
1. `scope.test.ts`: NEW test "STATE/CITY/VERIFICATION_TYPE removed from the catalog (ADR-0072)" — asserts
   `Object.keys(DIMENSIONS)` = `[AREA,CLIENT,PINCODE,PRODUCT]` and the active `scope_dimensions` = the same 4.
   RED before the change. Rework the **lockstep** test to `WHERE is_active`. Rework the **taskPredicate** test to
   drop the VT assertions, keep the PINCODE-falls-back-to-case-leg assertion (the `?? casePredicate` path).
2. Implement dimensions.ts + 0099 → GREEN.
3. The 5 scenario blocks that seed a removed dim then assert filtering will now 400 (UNKNOWN_DIMENSION) → **delete**
   them: cases.api.test.ts (STATE@2543, CITY@2597, VERIFICATION_TYPE@2659), tasks.api.test.ts (VT@265),
   scopeAssignments.api.test.ts (STATE@137).

## Verify
Full `pnpm verify` GREEN (crm2_test). Apply 0099 to crm2_dev; browser-verify the Role editor + user Access tab
no longer offer STATE/CITY/VERIFICATION_TYPE, and CLIENT/PRODUCT/PINCODE/AREA still work. Adversarial security
review: no scope widening, default-deny intact, the resolver never emits a wider predicate than before.
