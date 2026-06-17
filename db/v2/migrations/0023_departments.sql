-- 0023_departments.sql — organisational departments (admin User-Management sub-entity).
-- A required dropdown on the user form (v1 parity); designations link to a department and
-- users carry department_id. `name` is the identity (unique). Soft state via is_active +
-- effective_from (ADR-0017); OCC version + audit columns (ADR-0019). Parent-department and
-- department-head (v1 had both) are DEFERRED — not needed for the user form.
-- Forward-only, idempotent.

CREATE TABLE IF NOT EXISTS departments (
  id            serial PRIMARY KEY,
  name          varchar(150) NOT NULL,
  description   text         NOT NULL DEFAULT '',
  is_active     boolean      NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  version       integer      NOT NULL DEFAULT 1,
  created_by    uuid,
  updated_by    uuid,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_departments_name UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_departments_active ON departments (is_active);
CREATE INDEX IF NOT EXISTS idx_departments_effective_from ON departments (effective_from);
