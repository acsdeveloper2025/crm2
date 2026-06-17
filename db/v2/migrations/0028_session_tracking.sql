-- 0028_session_tracking.sql — active-session visibility (User-Management parity epic, slice 6).
-- Extends the existing auth_refresh_tokens (one row per issued refresh token = one session) with the
-- IP it was issued from and when it was last used (bumped on each refresh/rotation). A session is
-- "active" when revoked_at IS NULL AND expires_at > now(). Both self (GET /auth/sessions) and an admin
-- (GET /users/:id/sessions) can list + revoke-one. Forward-only, idempotent.

ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS ip inet;
ALTER TABLE auth_refresh_tokens ADD COLUMN IF NOT EXISTS last_used_at timestamptz NOT NULL DEFAULT now();
