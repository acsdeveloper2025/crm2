-- 0033_roles.sql — Access Control 2.0 slice 1 (ADR-0022): roles as data + editable
-- role→permission mapping. NO runtime reads yet (the authorize() cutover is slice 2) —
-- this migration only creates the configuration store and seeds it byte-identically to
-- the code-defined model, then swaps the users.role CHECK for an FK so the role catalog
-- has ONE source of truth. Forward-only, idempotent.

CREATE TABLE IF NOT EXISTS roles (
  code            varchar(20)  PRIMARY KEY,           -- UPPER_SNAKE, immutable handle
  name            varchar(150) NOT NULL,              -- display name (admin-editable)
  description     text,
  grants_all      boolean      NOT NULL DEFAULT false, -- true ONLY for SUPER_ADMIN (locked)
  hierarchy_mode  varchar(20)  NOT NULL,
  reports_to_role varchar(20)  REFERENCES roles (code), -- who users of this role report to (form filter)
  is_system       boolean      NOT NULL DEFAULT false,  -- delete/code-locked
  is_active       boolean      NOT NULL DEFAULT true,
  effective_from  timestamptz  NOT NULL DEFAULT now(),
  version         integer      NOT NULL DEFAULT 1,
  created_by      uuid,
  updated_by      uuid,
  created_at      timestamptz  NOT NULL DEFAULT now(),
  updated_at      timestamptz  NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_roles_hierarchy_mode') THEN
    ALTER TABLE roles ADD CONSTRAINT chk_roles_hierarchy_mode
      CHECK (hierarchy_mode IN ('ALL','SUBTREE','DIRECT_TEAM','SELF'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS role_permissions (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  role_code       varchar(20)  NOT NULL REFERENCES roles (code) ON DELETE CASCADE,
  permission_code varchar(128) NOT NULL,   -- validated against the CODE catalog at write time
  created_at      timestamptz  NOT NULL DEFAULT now()
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_role_permission') THEN
    ALTER TABLE role_permissions ADD CONSTRAINT uq_role_permission UNIQUE (role_code, permission_code);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_role_permissions_role ON role_permissions (role_code);

-- Seed the 6 system roles — behavior identical to the retired code constants:
-- SUPER_ADMIN grants_all + ALL; MANAGER subtree; TEAM_LEADER direct team; others self.
INSERT INTO roles (code, name, grants_all, hierarchy_mode, reports_to_role, is_system) VALUES
  ('SUPER_ADMIN',  'Super Admin',  true,  'ALL',         NULL,          true),
  ('MANAGER',      'Manager',      false, 'SUBTREE',     NULL,          true),
  ('TEAM_LEADER',  'Team Leader',  false, 'DIRECT_TEAM', 'MANAGER',     true),
  ('BACKEND_USER', 'Backend User', false, 'SELF',        'TEAM_LEADER', true),
  ('FIELD_AGENT',  'Field Agent',  false, 'SELF',        'TEAM_LEADER', true),
  ('KYC_VERIFIER', 'KYC Verifier', false, 'SELF',        'TEAM_LEADER', true)
ON CONFLICT (code) DO NOTHING;

-- Seed role→permission rows mirroring @crm2/access ROLE_PERMISSIONS (parity-tested).
-- SUPER_ADMIN holds NO rows — grants_all covers it.
INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',      'page.masterdata'),
  ('MANAGER',      'case.view'),
  ('MANAGER',      'case.create'),
  ('MANAGER',      'case.assign'),
  ('MANAGER',      'billing.generate'),
  ('MANAGER',      'data.export'),
  ('TEAM_LEADER',  'page.masterdata'),
  ('TEAM_LEADER',  'case.view'),
  ('TEAM_LEADER',  'case.assign'),
  ('TEAM_LEADER',  'data.export'),
  ('BACKEND_USER', 'page.masterdata'),
  ('BACKEND_USER', 'case.view'),
  ('BACKEND_USER', 'field_review.complete'),
  ('BACKEND_USER', 'data.export'),
  ('FIELD_AGENT',  'case.view'),
  ('KYC_VERIFIER', 'case.view')
ON CONFLICT (role_code, permission_code) DO NOTHING;

-- users.role: CHECK (closed 6-name list) → FK to the roles catalog (one source of truth).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_users_role') THEN
    ALTER TABLE users DROP CONSTRAINT chk_users_role;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_users_role') THEN
    ALTER TABLE users ADD CONSTRAINT fk_users_role FOREIGN KEY (role) REFERENCES roles (code);
  END IF;
END $$;
