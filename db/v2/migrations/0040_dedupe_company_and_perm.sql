-- 0040_dedupe_company_and_perm.sql — standalone Dedupe Check page support.
-- Two coupled concerns for the one feature:
--  1. case_applicants.company_name — a new optional identity column so "Company Name" is a real,
--     captured, searchable dedupe key (today applicants hold only name/mobile/pan). Indexed the same
--     way as the other dedupe keys (lower()).
--  2. dedupe.view — a dedicated read-only permission for the standalone page + dedupe-search endpoint
--     (NOT case.view: dedupe-search scans ALL cases cross-scope, so it must be granted deliberately).
--     Seeded for MANAGER/TEAM_LEADER/BACKEND_USER; SUPER_ADMIN authority is grants_all (no row).
--     Mirrors @crm2/access ROLE_PERMISSIONS (roles-seed parity test asserts byte-identity).
-- Mobile is UNAFFECTED: company_name is not part of the locked /sync/download dispatch contract.
-- Forward-only, idempotent.

BEGIN;

ALTER TABLE case_applicants ADD COLUMN IF NOT EXISTS company_name varchar(200);
CREATE INDEX IF NOT EXISTS idx_applicants_company ON case_applicants (lower(company_name));

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',      'dedupe.view'),
  ('TEAM_LEADER',  'dedupe.view'),
  ('BACKEND_USER', 'dedupe.view')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
