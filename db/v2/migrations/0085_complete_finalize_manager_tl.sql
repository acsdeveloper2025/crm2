-- 0085_complete_finalize_manager_tl.sql — RBAC: MANAGER + TEAM_LEADER may close/finalize desk work.
-- ADR-0050 (owner 2026-06-20). The office desk flow is two-actor: the office executive (KYC_VERIFIER,
-- the OFFICE assignment pool) relays the task to the authorised external source over email and forwards
-- the response back — it NEVER completes. The report + close was BACKEND_USER/SUPER_ADMIN only; the
-- owner extends that to supervisors (MANAGER + TEAM_LEADER) so they can also complete/finalize.
-- Mirrors @crm2/access ROLE_PERMISSIONS (parity-tested). Additive, idempotent (re-run safe).
-- KYC_VERIFIER is deliberately NOT granted these — it stays the read-only relay role.
BEGIN;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',     'field_review.complete'),
  ('MANAGER',     'case.finalize'),
  ('TEAM_LEADER', 'field_review.complete'),
  ('TEAM_LEADER', 'case.finalize')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
