-- 0093_rate_type_assignments.sql — ADR-0067 Phase B. Per-(client × product × verification_unit)
-- declaration of which rate_types are available. Additive, idempotent, re-run-safe.
-- NO FK conversion / resolution change here (that is Phase C, mig 0094).

BEGIN;

CREATE TABLE IF NOT EXISTS rate_type_assignments (
  id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id            integer     NOT NULL REFERENCES clients (id),
  product_id           integer     NOT NULL REFERENCES products (id),
  verification_unit_id integer     NOT NULL REFERENCES verification_units (id),
  rate_type_id         integer     NOT NULL REFERENCES rate_types (id),
  is_active            boolean     NOT NULL DEFAULT true,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One row per (combo, rate_type); bulk-set toggles is_active. Guarded so the re-run does not error.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_rate_type_assignment') THEN
    ALTER TABLE rate_type_assignments
      ADD CONSTRAINT uq_rate_type_assignment
      UNIQUE (client_id, product_id, verification_unit_id, rate_type_id);
  END IF;
END $$;

-- Availability lookup: active assignments for a combo.
CREATE INDEX IF NOT EXISTS idx_rta_combo
  ON rate_type_assignments (client_id, product_id, verification_unit_id)
  WHERE is_active;

COMMIT;
