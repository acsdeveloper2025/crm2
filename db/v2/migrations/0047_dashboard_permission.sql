-- 0047_dashboard_permission.sql — Dashboard read-only operations overview (ADR-0029).
-- Grants page.dashboard to every web role except FIELD_AGENT (mobile-only). SUPER_ADMIN holds it
-- via grants_all (no explicit row). The dashboard runs entirely on existing tables (case_tasks /
-- cases) through the scope seam — NO new tables, NO materialized view (a snapshot would go stale
-- and break "every number is live"; per-actor scope makes a shared MV impossible anyway).
-- Mirrors @crm2/access ROLE_PERMISSIONS — the roles parity test asserts byte-identity.
-- Forward-only, idempotent.
BEGIN;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',      'page.dashboard'),
  ('TEAM_LEADER',  'page.dashboard'),
  ('BACKEND_USER', 'page.dashboard'),
  ('KYC_VERIFIER', 'page.dashboard')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
