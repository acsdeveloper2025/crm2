-- 0048_role_password_expiry.sql — per-role password-rotation policy.
-- A role may force its users to change their password every N days (enforced at login + token
-- refresh: mustChangePassword). NULL = never expire — the exemption (field agents + super admin
-- default to NULL). Configurable per role at role create/edit. Forward-only, idempotent.

ALTER TABLE roles ADD COLUMN IF NOT EXISTS password_expiry_days integer;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_roles_password_expiry_days') THEN
    ALTER TABLE roles ADD CONSTRAINT chk_roles_password_expiry_days
      CHECK (password_expiry_days IS NULL OR (password_expiry_days >= 1 AND password_expiry_days <= 3650));
  END IF;
END $$;

-- Default policy: 90-day rotation for the office roles; field agents + super admin stay exempt (NULL).
-- Guarded by `IS NULL` so a re-run never clobbers an admin's later per-role change.
UPDATE roles SET password_expiry_days = 90
  WHERE code IN ('MANAGER', 'TEAM_LEADER', 'BACKEND_USER', 'KYC_VERIFIER')
    AND password_expiry_days IS NULL;
