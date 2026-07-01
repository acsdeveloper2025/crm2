-- 0109_mis_permissions.sql — ADR-0084: RBAC seed for the rebuilt MIS (predefined report types +
-- code-owned column allow-list; supersedes the removed ADR-0037/0049 engine). Two permissions:
--   mis.view   — the MIS page + report-type catalog + rows/summary
--   mis.export — export (sync; ≥10k returns 413 in v1)
-- Granted to the operational web roles that held the old page.mis + data.export: MANAGER, TEAM_LEADER,
-- BACKEND_USER. SUPER_ADMIN is covered by grants_all (holds ZERO explicit rows — roles-parity-tested).
-- Money columns inside MIS stay separately gated by billing.view; bulk PII export is owner-accepted
-- (COMPLIANCE_GAPS_REGISTRY §MIS-2026-07-01). Mirrors @crm2/access ROLE_PERMISSIONS.
-- Forward-only, idempotent, re-run-safe.

BEGIN;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',      'mis.view'),
  ('TEAM_LEADER',  'mis.view'),
  ('BACKEND_USER', 'mis.view'),
  ('MANAGER',      'mis.export'),
  ('TEAM_LEADER',  'mis.export'),
  ('BACKEND_USER', 'mis.export')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
