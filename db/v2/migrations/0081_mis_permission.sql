-- 0081_mis_permission.sql — ADR-0049: page.mis gates the MIS report page (desk roles).
-- Grants the MIS view page permission to desk roles: MANAGER, TEAM_LEADER, BACKEND_USER.
-- SUPER_ADMIN is covered by grants_all and requires no explicit row.
-- Mirrors @crm2/access ROLE_PERMISSIONS (roles-parity-tested). Forward-only, idempotent.

BEGIN;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',      'page.mis'),
  ('TEAM_LEADER',  'page.mis'),
  ('BACKEND_USER', 'page.mis')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
