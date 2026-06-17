-- 0059_billing_view_perm.sql — `billing.view` permission (ADR-0036, billing slice 5b).
-- Gates the per-case Billing & Commission read-model (GET /api/v2/billing/cases) — bill +
-- agent-commission amounts per completed task. Billing operators only: MANAGER + BACKEND_USER
-- (SUPER_ADMIN covered by grants_all). NOT the broad masterdata viewers; the commission-rate CONFIG
-- list stays masterdata.manage (SA-only). Mirrors @crm2/access ROLE_PERMISSIONS (roles-parity-tested).
-- Forward-only, idempotent.

BEGIN;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',      'billing.view'),
  ('BACKEND_USER', 'billing.view')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
