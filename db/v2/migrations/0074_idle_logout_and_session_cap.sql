-- 0074_idle_logout_and_session_cap.sql — web idle auto-logout + absolute session cap (ADR-0045).
-- roles.idle_logout_minutes: warn-then-logout window for DESK web users; NULL = exempt (FIELD_AGENT).
-- roles.max_session_minutes: absolute session lifetime regardless of activity; NULL = no cap.
-- auth_refresh_tokens.absolute_expires_at: hard session deadline set at login, never extended by
-- rotation — the existing `expires_at > now()` refresh check enforces it. Forward-only, idempotent.

ALTER TABLE roles ADD COLUMN IF NOT EXISTS idle_logout_minutes integer;
ALTER TABLE roles ADD COLUMN IF NOT EXISTS max_session_minutes integer;
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS absolute_expires_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_roles_idle_logout_minutes') THEN
    ALTER TABLE roles ADD CONSTRAINT chk_roles_idle_logout_minutes
      CHECK (idle_logout_minutes IS NULL OR (idle_logout_minutes >= 1 AND idle_logout_minutes <= 1440));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_roles_max_session_minutes') THEN
    ALTER TABLE roles ADD CONSTRAINT chk_roles_max_session_minutes
      CHECK (max_session_minutes IS NULL OR (max_session_minutes >= 5 AND max_session_minutes <= 10080));
  END IF;
END $$;

-- Default policy: DESK roles + SUPER_ADMIN get 10-min idle + 12h (720-min) absolute cap; FIELD_AGENT
-- stays exempt (NULL). Guarded by `IS NULL` so a re-run never clobbers an admin's later per-role change.
UPDATE roles SET idle_logout_minutes = 10
  WHERE code IN ('SUPER_ADMIN', 'MANAGER', 'TEAM_LEADER', 'BACKEND_USER', 'KYC_VERIFIER')
    AND idle_logout_minutes IS NULL;
UPDATE roles SET max_session_minutes = 720
  WHERE code IN ('SUPER_ADMIN', 'MANAGER', 'TEAM_LEADER', 'BACKEND_USER', 'KYC_VERIFIER')
    AND max_session_minutes IS NULL;
