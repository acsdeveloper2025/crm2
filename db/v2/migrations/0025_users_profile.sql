-- 0025_users_profile.sql — user profile fields (User-Management parity epic, slice 3).
-- Adds the v1 user-form fields v2 lacked: auto-generated employee_id, phone, department +
-- designation FKs, and a password_must_change flag (the force-change-on-first-login flow lands
-- in slice 4). Columns are NULLABLE so the seed admin + the FK-free user import keep working;
-- the interactive create/edit FORM requires phone/department/designation. employee_id is the one
-- always-present field — minted server-side from a sequence (CRM-00001, CRM-00002, …) and UNIQUE.
-- Forward-only, idempotent.

CREATE SEQUENCE IF NOT EXISTS user_employee_seq;

ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id varchar(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone varchar(20);
ALTER TABLE users ADD COLUMN IF NOT EXISTS department_id integer REFERENCES departments (id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS designation_id integer REFERENCES designations (id);
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_must_change boolean NOT NULL DEFAULT false;

-- Backfill existing rows (seed admin + any dev-created users) with a minted employee_id.
UPDATE users
SET employee_id = 'CRM-' || lpad(nextval('user_employee_seq')::text, 5, '0')
WHERE employee_id IS NULL;

-- UNIQUE allows multiple NULLs in pg, but every create mints one → effectively always-present.
-- Idempotent: a UNIQUE constraint owns an index of the same name, so a re-run collides on the
-- relation (42P07), not duplicate_object — guard on pg_constraint instead of catching exceptions.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_users_employee_id') THEN
    ALTER TABLE users ADD CONSTRAINT uq_users_employee_id UNIQUE (employee_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_users_department_id ON users (department_id);
CREATE INDEX IF NOT EXISTS idx_users_designation_id ON users (designation_id);
