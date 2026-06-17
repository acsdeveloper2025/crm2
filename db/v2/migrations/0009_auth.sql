-- 0009_auth.sql — authentication (ADR-0014). Adds credential storage to users and a
-- rotating refresh-token store (denylist). Access tokens are stateless JWTs (not stored).
-- Forward-only, idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash  text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_set_at timestamptz;

-- One row per issued refresh token (keyed by its JWT `jti`). Rotation revokes the old row
-- and inserts a new one; logout / password change revoke. A token is valid only if its row
-- exists, is unexpired, and revoked_at IS NULL.
CREATE TABLE IF NOT EXISTS auth_refresh_tokens (
  jti         uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  device_id   varchar(128),
  device_info text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_auth_refresh_user ON auth_refresh_tokens (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_refresh_expires ON auth_refresh_tokens (expires_at);

-- Seed the dev SUPER_ADMIN password = 'admin123' (scrypt, ADR-0014 format
-- scrypt$N$r$p$saltB64$hashB64) so login works out of the box in dev/test.
UPDATE users
SET password_hash = 'scrypt$16384$8$1$J3hE0MvXk7dDKqKGoSAk1w$kFNxLixr0LaM1AOmQYOai9Y9YHTzZAhKH8UwGKKyZAI',
    password_set_at = now()
WHERE username = 'admin' AND password_hash IS NULL;
