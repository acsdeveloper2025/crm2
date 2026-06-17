-- 0024_designations.sql — job designations/titles (admin User-Management sub-entity).
-- A required dropdown on the user form (v1 parity). Optionally linked to a department
-- (v1 had the same optional link). `name` is the identity (unique). Soft state via
-- is_active + effective_from (ADR-0017); OCC version + audit columns (ADR-0019).
-- Forward-only, idempotent.

CREATE TABLE IF NOT EXISTS designations (
  id            serial PRIMARY KEY,
  name          varchar(150) NOT NULL,
  description   text         NOT NULL DEFAULT '',
  department_id integer      REFERENCES departments (id),
  is_active     boolean      NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  version       integer      NOT NULL DEFAULT 1,
  created_by    uuid,
  updated_by    uuid,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_designations_name UNIQUE (name)
);

CREATE INDEX IF NOT EXISTS idx_designations_active ON designations (is_active);
CREATE INDEX IF NOT EXISTS idx_designations_effective_from ON designations (effective_from);
CREATE INDEX IF NOT EXISTS idx_designations_department ON designations (department_id);
