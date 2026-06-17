-- 0027_mfa.sql — multi-factor authentication (User-Management parity epic, slice 5).
-- Per-user TOTP: the shared secret is stored ENCRYPTED at rest (AES-256-GCM, platform/encryption.ts).
-- Enrolment is two-step: a row is created on enroll/start (enrolled_at NULL = pending) and confirmed
-- on enroll/verify (enrolled_at set, recovery codes minted). 10 one-time recovery codes are stored
-- hashed (scrypt, like passwords) with a parallel used-flag array. `users.mfa_required` lets an admin
-- force a specific user to enrol before their next sign-in.
-- Forward-only, idempotent.

ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_required boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS user_mfa_secrets (
  user_id              uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  secret_encrypted     text NOT NULL,
  recovery_code_hashes text[] NOT NULL DEFAULT '{}',
  recovery_code_used   boolean[] NOT NULL DEFAULT '{}',
  enrolled_at          timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
