-- 0118_scope_wire_office_roles.sql — Wire MANAGER + TEAM_LEADER to the CLIENT/PRODUCT scope
-- dimensions, fail-closed (ADR-0072).
--
-- Scope is OPT-IN per role: `resolveScope` only iterates the dimensions wired for the actor's role,
-- and an UNWIRED dimension is UNRESTRICTED — platform/scope/repository.ts returns early when the
-- wiring set is empty, platform/scope/index.ts `scopedEntityIds` then returns undefined, and
-- clients/repository.ts `($1::int[] IS NULL OR id = ANY($1))` degrades to "every row".
--
-- The 0034 seed wired only FIELD_AGENT, KYC_VERIFIER and BACKEND_USER. MANAGER was therefore never
-- wired on ANY environment: every MANAGER saw the entire client + product catalog in the
-- case-creation pickers and could create a case for any client (cases/service.ts even documents the
-- undefined case as expected for "SUPER_ADMIN/MANAGER/unwired roles"). TEAM_LEADER had been wired on
-- production through the role admin UI but not on staging/local — the same drift, one env at a time.
--
-- This converges every environment on the fail-closed default. Idempotent: a role/dimension pair that
-- already exists (prod TEAM_LEADER) is skipped, so re-running is a no-op.
--
-- ⚠️ OPERATOR NOTE — RESTRICT with no `user_scope_assignments` row means the user sees NOTHING.
-- Each MANAGER/TEAM_LEADER must be granted their client+product portfolio BEFORE (or in the same
-- transaction as) this migration. Portfolios were granted on production and staging on 2026-07-14
-- alongside this change; any NEW environment must grant before running it.
--
-- KYC_VERIFIER is deliberately NOT wired here: KYC verifiers are scoped by verification-unit
-- assignment (`user_kyc_unit_access`, ADR-0073), not by client/product.
--
-- Hierarchy is unchanged and already correct: BACKEND_USER=SELF, TEAM_LEADER=DIRECT_TEAM,
-- MANAGER=SUBTREE (0033_roles.sql). This migration only adds the client/product cap on top.

BEGIN;

INSERT INTO role_scope_dimensions (role_code, dimension_code, mode, is_active)
SELECT r.code, d.code, 'RESTRICT', true
FROM (VALUES ('MANAGER'), ('TEAM_LEADER')) AS r(code)
CROSS JOIN (VALUES ('CLIENT'), ('PRODUCT')) AS d(code)
WHERE NOT EXISTS (
  SELECT 1
  FROM role_scope_dimensions x
  WHERE x.role_code = r.code
    AND x.dimension_code = d.code
);

COMMIT;
