-- 0053_task_execute_perm.sql — field-execution permission (ADR-0032 slice 2c).
-- `task.execute` lets a FIELD_AGENT drive their OWN assigned task on the device via
-- /api/v2/verification-tasks (start/submit/complete/revoke/priority). FIELD_AGENT only;
-- SUPER_ADMIN covered by grants_all. Mirrors @crm2/access ROLE_PERMISSIONS (parity-tested).
-- The endpoint additionally binds assigned_to = actor (the perm grants the capability; ownership
-- is enforced per-request). Forward-only, idempotent.

BEGIN;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('FIELD_AGENT', 'task.execute')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
