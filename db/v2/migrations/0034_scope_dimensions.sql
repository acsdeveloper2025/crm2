-- 0034_scope_dimensions.sql — Access Control 2.0 slice 3 (ADR-0022): the GENERIC scope-assignment
-- model. Three tables replace the four dimension-specific Epic-F tables (0030/0032):
--   scope_dimensions       — code-seeded catalog (the enforcement SQL per dimension lives in code)
--   role_scope_dimensions  — admin wiring: which dimensions a role may hold + EXPAND/RESTRICT mode
--   user_scope_assignments — one table for every user↔entity assignment (ID- or VALUE-keyed)
-- Existing assignment rows are migrated, then the old tables are dropped (greenfield; the old
-- /territory + /portfolio APIs are replaced in the same slice). Forward-only, idempotent.

CREATE TABLE IF NOT EXISTS scope_dimensions (
  code        varchar(32)  PRIMARY KEY,
  label       varchar(100) NOT NULL,
  entity_kind varchar(8)   NOT NULL,  -- 'ID' (catalog-row id) | 'VALUE' (text, e.g. a state name)
  level       varchar(8)   NOT NULL,  -- 'CASE' | 'TASK' (where the predicate applies)
  is_active   boolean      NOT NULL DEFAULT true
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_scope_dimensions_kind') THEN
    ALTER TABLE scope_dimensions ADD CONSTRAINT chk_scope_dimensions_kind
      CHECK (entity_kind IN ('ID','VALUE'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_scope_dimensions_level') THEN
    ALTER TABLE scope_dimensions ADD CONSTRAINT chk_scope_dimensions_level
      CHECK (level IN ('CASE','TASK'));
  END IF;
END $$;

INSERT INTO scope_dimensions (code, label, entity_kind, level) VALUES
  ('CLIENT',            'Client',            'ID',    'CASE'),
  ('PRODUCT',           'Product',           'ID',    'CASE'),
  ('PINCODE',           'Pincode',           'ID',    'CASE'),
  ('AREA',              'Area',              'ID',    'CASE'),
  ('STATE',             'State',             'VALUE', 'CASE'),
  ('CITY',              'City',              'VALUE', 'CASE'),
  ('VERIFICATION_TYPE', 'Verification Type', 'ID',    'TASK')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS role_scope_dimensions (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_code      varchar(20) NOT NULL REFERENCES roles (code) ON DELETE CASCADE,
  dimension_code varchar(32) NOT NULL REFERENCES scope_dimensions (code),
  mode           varchar(8)  NOT NULL,  -- EXPAND adds visibility on top of hierarchy; RESTRICT caps it
  is_active      boolean     NOT NULL DEFAULT true
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_role_scope_mode') THEN
    ALTER TABLE role_scope_dimensions ADD CONSTRAINT chk_role_scope_mode
      CHECK (mode IN ('EXPAND','RESTRICT'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_role_scope_dimension') THEN
    ALTER TABLE role_scope_dimensions ADD CONSTRAINT uq_role_scope_dimension
      UNIQUE (role_code, dimension_code);
  END IF;
END $$;

-- Day-0 wiring mirrors the retired hardcoded model: field roles hold territory, backend users
-- hold portfolio, all EXPAND (assignments add visibility on top of the hierarchy layer).
INSERT INTO role_scope_dimensions (role_code, dimension_code, mode) VALUES
  ('FIELD_AGENT',  'PINCODE', 'EXPAND'),
  ('FIELD_AGENT',  'AREA',    'EXPAND'),
  ('KYC_VERIFIER', 'PINCODE', 'EXPAND'),
  ('KYC_VERIFIER', 'AREA',    'EXPAND'),
  ('BACKEND_USER', 'CLIENT',  'EXPAND'),
  ('BACKEND_USER', 'PRODUCT', 'EXPAND')
ON CONFLICT (role_code, dimension_code) DO NOTHING;

CREATE TABLE IF NOT EXISTS user_scope_assignments (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid        NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  dimension_code varchar(32) NOT NULL REFERENCES scope_dimensions (code),
  entity_id      integer,    -- ID-kind dimensions: a catalog row id (validated in the service;
                             -- catalogs deactivate rather than hard-DELETE, so refs cannot dangle)
  entity_value   text,       -- VALUE-kind dimensions: e.g. a state/city name
  is_active      boolean     NOT NULL DEFAULT true,
  assigned_by    uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_usa_exactly_one_key') THEN
    ALTER TABLE user_scope_assignments ADD CONSTRAINT chk_usa_exactly_one_key
      CHECK ((entity_id IS NULL) <> (entity_value IS NULL));
  END IF;
END $$;

-- Partial unique indexes (one per key kind) — the idempotent-add ON CONFLICT targets.
CREATE UNIQUE INDEX IF NOT EXISTS uq_usa_entity_id
  ON user_scope_assignments (user_id, dimension_code, entity_id) WHERE entity_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_usa_entity_value
  ON user_scope_assignments (user_id, dimension_code, entity_value) WHERE entity_value IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_usa_user ON user_scope_assignments (user_id);

-- Migrate the Epic-F assignment rows (0030/0032) into the generic table, then drop the old tables.
-- Guarded by to_regclass so a re-run (tables already dropped) is a clean no-op.
DO $$ BEGIN
  IF to_regclass('user_pincode_assignments') IS NOT NULL THEN
    INSERT INTO user_scope_assignments (user_id, dimension_code, entity_id, is_active, assigned_by, created_at)
    SELECT user_id, 'PINCODE', pincode_id, is_active, assigned_by, created_at FROM user_pincode_assignments
    ON CONFLICT DO NOTHING;
  END IF;
  IF to_regclass('user_area_assignments') IS NOT NULL THEN
    INSERT INTO user_scope_assignments (user_id, dimension_code, entity_id, is_active, assigned_by, created_at)
    SELECT user_id, 'AREA', area_id, is_active, assigned_by, created_at FROM user_area_assignments
    ON CONFLICT DO NOTHING;
  END IF;
  IF to_regclass('user_client_assignments') IS NOT NULL THEN
    INSERT INTO user_scope_assignments (user_id, dimension_code, entity_id, is_active, assigned_by, created_at)
    SELECT user_id, 'CLIENT', client_id, is_active, assigned_by, created_at FROM user_client_assignments
    ON CONFLICT DO NOTHING;
  END IF;
  IF to_regclass('user_product_assignments') IS NOT NULL THEN
    INSERT INTO user_scope_assignments (user_id, dimension_code, entity_id, is_active, assigned_by, created_at)
    SELECT user_id, 'PRODUCT', product_id, is_active, assigned_by, created_at FROM user_product_assignments
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

DROP TABLE IF EXISTS user_pincode_assignments;
DROP TABLE IF EXISTS user_area_assignments;
DROP TABLE IF EXISTS user_client_assignments;
DROP TABLE IF EXISTS user_product_assignments;
