-- 0095_case_create_backend_team_leader.sql — grant `case.create` to BACKEND_USER + TEAM_LEADER (ADR-0065).
-- (0093/0094 are reserved by ADR-0064 rate-type phases B/C; this takes the next free number, 0095.)
-- Audit finding SR-4: BACKEND_USER (and TEAM_LEADER) could not create a case or add tasks for their
-- assigned client+product — `authorize(case.create)` 403'd because neither role held the permission.
-- `case.create` is an EXISTING permission already enforced by `POST /cases`, `POST /:id/tasks`,
-- `POST /:id/applicants` (MANAGER + SUPER_ADMIN already hold it). This additively grants it to the two
-- desk roles. Paired with write-side CLIENT/PRODUCT portfolio-scope validation in the cases service
-- (audit SR-1/2/3) so the grant cannot create cases outside the actor's portfolio.
-- Mirrors @crm2/access ROLE_PERMISSIONS (roles-parity-tested). Forward-only, idempotent.

BEGIN;

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('BACKEND_USER', 'case.create'),
  ('TEAM_LEADER',  'case.create')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
