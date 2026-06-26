-- 0100_user_kyc_unit_access.sql — ADR-0073. Per-user KYC-unit ASSIGNMENT ELIGIBILITY (not visibility):
-- a KYC verifier is granted specific KYC units; an OFFICE task is assignable only to KYC users granted
-- that task's unit. The visibility resolver NEVER reads this table — KYC verifiers stay SELF-scoped.
-- Required-grant model: no grant ⇒ not assignable for that unit. Forward-only, idempotent.
--
-- CREATE TABLE on a NEW table + an INSERT…SELECT that only READS users/verification_units (ACCESS SHARE,
-- compatible with the still-serving old api during a rolling deploy) → no hot-table ACCESS EXCLUSIVE, so no
-- lock-retry preamble needed (unlike the DDL on existing tables in 0097/0098).

BEGIN;

CREATE TABLE IF NOT EXISTS user_kyc_unit_access (
  id                   integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id              uuid        NOT NULL REFERENCES users(id),
  verification_unit_id integer     NOT NULL REFERENCES verification_units(id),
  is_active            boolean     NOT NULL DEFAULT true,
  created_by           uuid,
  created_at           timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_user_kyc_unit UNIQUE (user_id, verification_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_ukua_user ON user_kyc_unit_access (user_id) WHERE is_active;

-- Backfill: grant every existing OFFICE-pool-role user access to every active verification unit (field or
-- office — a KYC verifier can be OFFICE-assigned a task at any unit), so live OFFICE assignment (today an
-- open pool) doesn't break on deploy. Admins prune afterward. Role resolved from data (assignment_pool_roles
-- — no role-name literal). Idempotent via ON CONFLICT.
INSERT INTO user_kyc_unit_access (user_id, verification_unit_id)
SELECT u.id, vu.id
  FROM users u
  CROSS JOIN verification_units vu
 WHERE u.role = (SELECT role_code FROM assignment_pool_roles WHERE visit_type = 'OFFICE')
   AND vu.is_active
ON CONFLICT (user_id, verification_unit_id) DO NOTHING;

COMMIT;
