-- 0070_mobile_consents.sql — DPDP consent acceptances (mobile parity, ADR-0012 §5).
-- The field app records the agent's acceptance of the privacy policy version on accept + every login
-- (best-effort, idempotent). One row per (user, policy_version); re-accept UPSERTs the timestamp/ip/UA.
-- Forward-only, idempotent. Triple-write: file → test:5433 (auto) → dev:54329 (psql -f).

BEGIN;

CREATE TABLE IF NOT EXISTS consents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  policy_version integer NOT NULL,
  accepted_at    timestamptz NOT NULL DEFAULT now(),
  ip             inet,
  user_agent     text,
  CONSTRAINT uq_consents_user_version UNIQUE (user_id, policy_version)
);
CREATE INDEX IF NOT EXISTS idx_consents_user ON consents (user_id);

COMMIT;
