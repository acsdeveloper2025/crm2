-- 0007_users.sql — User identity master-data (admin).
-- Identity only: username, display name, email, role, manager hierarchy, active flag.
-- Credentials/authentication (password, JWT issuance, login) are a SEPARATE architecture
-- phase (mobile JWT-pair compat per ADR-0012) and are intentionally NOT modelled here.
-- Forward-only, idempotent. (0005 was a removed orphan; gap is intentional.)

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username    varchar(50)  NOT NULL,
  name        varchar(150) NOT NULL,
  email       varchar(255),
  role        varchar(20)  NOT NULL,
  reports_to  uuid REFERENCES users(id),
  is_active   boolean      NOT NULL DEFAULT true,
  created_by  uuid,
  updated_by  uuid,
  created_at  timestamptz  NOT NULL DEFAULT now(),
  updated_at  timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_users_username UNIQUE (username),
  CONSTRAINT chk_users_role CHECK (
    role IN ('SUPER_ADMIN','MANAGER','TEAM_LEADER','BACKEND_USER','FIELD_AGENT','KYC_VERIFIER')
  ),
  CONSTRAINT chk_users_not_self_manager CHECK (reports_to IS NULL OR reports_to <> id)
);

CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);
CREATE INDEX IF NOT EXISTS idx_users_reports_to ON users (reports_to);
CREATE INDEX IF NOT EXISTS idx_users_active ON users (is_active);

-- Seed the dev/system SUPER_ADMIN so the dev auth seam's fixed user id resolves and
-- audit columns (created_by) reference a real principal.
INSERT INTO users (id, username, name, email, role, created_by, updated_by)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'admin', 'System Administrator', 'admin@crm2.local', 'SUPER_ADMIN',
  '00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (id) DO NOTHING;
