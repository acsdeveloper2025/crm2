-- 0026_auth_lockout.sql — account lockout state (User-Management parity epic, slice 4).
-- Tracks consecutive failed logins so the auth service can lock an account after N failures and
-- auto-unlock after a cooldown (locked_until). An admin can clear both via POST /users/:id/unlock.
-- password_must_change (the force-change-on-first-login flag) already exists from 0025.
-- Forward-only, idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS failed_login_count integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS locked_until timestamptz;
