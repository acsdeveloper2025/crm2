-- 0039_visit_type_pool.sql — ADR-0024: Field/Office assignment pool + per-task verification location.
-- The operator PICKS the pool when adding/assigning a task: visit_type FIELD (a field agent visits)
-- or OFFICE (a desk verifier handles it). This REPLACES the old SITE/NO_VISIT values and decouples
-- the eligible role from the unit's worker_role — the role is resolved from the chosen visit mode via
-- the seeded `assignment_pool_roles` mapping (data, so no role-name literals live in code).
-- A FIELD task carries its own verification location (pincode/area) — the case-level location scopes
-- the case; the per-task location drives the field-agent territory match AND the rate-type lookup.
-- Mobile is UNAFFECTED: visit_type is not part of the locked /sync/download dispatch contract.
-- Forward-only, idempotent.

BEGIN;

-- 1. Drop the old SITE/NO_VISIT CHECK FIRST so the re-value below is allowed (and so a re-run is
--    idempotent — the ADD at the end re-creates it cleanly).
ALTER TABLE case_tasks DROP CONSTRAINT IF EXISTS chk_case_task_visit_type;

-- 2. Re-value existing case_tasks visit_type. The `task_assignment_history` log is append-only
--    (immutability trigger) and has NO visit_type CHECK, so its historical SITE/NO_VISIT rows are
--    left as the point-in-time record they are — intentionally not rewritten.
UPDATE case_tasks SET visit_type = 'FIELD' WHERE visit_type = 'SITE';
UPDATE case_tasks SET visit_type = 'OFFICE' WHERE visit_type = 'NO_VISIT';

-- 3. Add the new CHECK: FIELD/OFFICE (still nullable — an unassigned task has none).
ALTER TABLE case_tasks ADD CONSTRAINT chk_case_task_visit_type
  CHECK (visit_type IS NULL OR visit_type::text = ANY (ARRAY['FIELD', 'OFFICE']));

-- 3. Per-task verification location (FK to a `locations` (pincode, area) row). NULL for OFFICE tasks
--    and for tasks added without a location yet. Drives territory eligibility + rate resolution.
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS pincode_id integer REFERENCES locations (id);
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS area_id integer REFERENCES locations (id);
CREATE INDEX IF NOT EXISTS idx_case_tasks_task_area ON case_tasks (area_id);

-- 4. The pool mapping: visit type → the single role eligible for it. Seeded data, FK to the open
--    roles catalog — admin-extensible, and code reads the role from here (never a literal).
CREATE TABLE IF NOT EXISTS assignment_pool_roles (
  visit_type varchar(20) PRIMARY KEY,
  role_code  varchar(40) NOT NULL REFERENCES roles (code),
  label      varchar(40) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO assignment_pool_roles (visit_type, role_code, label) VALUES
  ('FIELD',  'FIELD_AGENT',  'Field'),
  ('OFFICE', 'KYC_VERIFIER', 'Office')
ON CONFLICT (visit_type) DO NOTHING;

COMMIT;
