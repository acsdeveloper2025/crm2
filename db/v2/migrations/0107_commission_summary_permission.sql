-- 0107_commission_summary_permission.sql — ADR-0081: a DEDICATED permission for the periodic
-- Commission Summary page/export, grantable independently of billing.view (the per-case Billing page).
-- Grants it to the SAME roles that hold billing.view today so there is no access regression: MANAGER +
-- BACKEND_USER. SUPER_ADMIN is covered by grants_all and requires no explicit row.
-- Mirrors @crm2/access ROLE_PERMISSIONS (roles-parity-tested). Forward-only, idempotent, re-run-safe.

BEGIN;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',      'billing.commission_summary.view'),
  ('BACKEND_USER', 'billing.commission_summary.view')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
