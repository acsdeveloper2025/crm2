-- 0056_task_revoke_perm.sql — backend/office task revoke (ADR-0033 correction 2026-06-16, v1 parity).
-- Re-establishes `task.revoke`: the backend/office revokes a LIVE task ({ASSIGNED,IN_PROGRESS} →
-- REVOKED with a reason); a COMPLETED task CANNOT be revoked (it is reworked via REVISIT). Matches v1
-- `verificationTasksController.revokeTask` (perm `task.revoke`). The earlier slice-3 cut wrongly
-- removed backend revoke entirely; the real rule is only "not COMPLETED". BACKEND_USER + MANAGER
-- (SUPER_ADMIN covered by grants_all); mirrors @crm2/access ROLE_PERMISSIONS (roles-parity-tested).
-- The device revoke of its OWN assigned task stays on `task.execute` (same DB transition, scope- vs
-- ownership-bound). Forward-only, idempotent.

BEGIN;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('BACKEND_USER', 'task.revoke'),
  ('MANAGER',      'task.revoke')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
