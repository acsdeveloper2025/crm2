-- 0030_user_territory_assignments.sql — field-territory scope (Access & Scope milestone, Epic F).
-- A FIELD_AGENT / KYC_VERIFIER is scoped to the pincodes (and, more granularly, areas) assigned to
-- them. v2 `locations` rows are (pincode, area) pairs; both pincode_id and area_id reference a
-- `locations` row id (a pincode assignment is the coarser grain, an area assignment the finer).
-- Many assignments per user. Forward-only, idempotent.

CREATE TABLE IF NOT EXISTS user_pincode_assignments (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  pincode_id  integer NOT NULL REFERENCES locations (id),
  is_active   boolean NOT NULL DEFAULT true,
  assigned_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_area_assignments (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  area_id     integer NOT NULL REFERENCES locations (id),
  is_active   boolean NOT NULL DEFAULT true,
  assigned_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Idempotency guards (the persistent test DB accumulates migrations across runs).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_pincode') THEN
    ALTER TABLE user_pincode_assignments ADD CONSTRAINT uq_user_pincode UNIQUE (user_id, pincode_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_area') THEN
    ALTER TABLE user_area_assignments ADD CONSTRAINT uq_user_area UNIQUE (user_id, area_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_upa_user ON user_pincode_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_uaa_user ON user_area_assignments (user_id);
