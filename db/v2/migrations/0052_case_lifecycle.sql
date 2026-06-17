-- 0052_case_lifecycle.sql — case lifecycle spine (ADR-0032, slice 1).
-- Adds the missing CASE-track machinery to close the lifecycle the audit found half-built:
--   • cases.version            — OCC token for case-level compare-and-set (case.finalize is a
--                                money/race path; `cases` had NO version column — 0017/0036 only
--                                added it to other tables). Mirrors case_tasks.version (0036).
--   • cases.status CHECK widen  — adds AWAITING_COMPLETION (all non-revoked tasks COMPLETED, awaiting
--                                the office verdict) + REVOKED. Strict SUPERSET of the existing
--                                (NEW, IN_PROGRESS, COMPLETED, CANCELLED) → NO data migration; every
--                                existing row stays valid. pg has no ADD CONSTRAINT IF NOT EXISTS →
--                                drop-then-add.
--   • cases.verification_outcome + result_remark + completed_at + completed_by
--                                — the ONE FINAL case VERDICT (ADR-0032 D3), office-authored at
--                                case.finalize, derived from the per-task office results. This is the
--                                column the client report prints — now an explicit office decision,
--                                NOT a stale rollup (fixes v1 VT-000199 fragmentation). completed_by
--                                is a plain uuid (no FK) matching the actor-column pattern
--                                (assigned_by/created_by/updated_by/case_tasks.completed_by 0041).
--   • case_tasks.started_at + form_data — field-execution columns the §5 ingest spine (slice 2)
--                                will write (device start → started_at; device submit → form_data).
--                                Added now so the read-model/TASK_VIEW is stable before ingest lands.
-- NOTE: case_tasks.verification_outcome/remark/completed_at/completed_by (0041) are KEPT AS-IS — the
--   per-task office RESULT (ADR-0032 D3); this migration does NOT touch or demote them.
-- Forward-only, idempotent. Triple-write: file → test:5433 (auto) → dev:54329 (psql -f).

BEGIN;

-- ── Case-level OCC ─────────────────────────────────────────────────────────────────────────
ALTER TABLE cases ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- ── Case status enum widen (superset → no data migration) ────────────────────────────────────
ALTER TABLE cases DROP CONSTRAINT IF EXISTS chk_cases_status;
ALTER TABLE cases ADD CONSTRAINT chk_cases_status
  CHECK (status IN ('NEW', 'IN_PROGRESS', 'AWAITING_COMPLETION', 'COMPLETED', 'REVOKED', 'CANCELLED'));

-- ── The ONE FINAL case verdict (office-authored at case.finalize) ─────────────────────────────
ALTER TABLE cases ADD COLUMN IF NOT EXISTS verification_outcome varchar(20);
ALTER TABLE cases ADD COLUMN IF NOT EXISTS result_remark text;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS completed_by uuid;  -- actor column, no FK (matches pattern)

ALTER TABLE cases DROP CONSTRAINT IF EXISTS chk_cases_verification_outcome;
ALTER TABLE cases ADD CONSTRAINT chk_cases_verification_outcome
  CHECK (verification_outcome IS NULL
         OR verification_outcome IN ('POSITIVE', 'NEGATIVE', 'REFER', 'FRAUD'));

-- ── Field-execution columns (written by the §5 ingest spine, slice 2) ─────────────────────────
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS started_at timestamptz;
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS form_data jsonb;

-- ── RBAC: case.finalize → BACKEND_USER (SUPER_ADMIN covered by grants_all; mirrors @crm2/access
--    ROLE_PERMISSIONS, parity-tested). KYC_VERIFIER stays read-only. ───────────────────────────
INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('BACKEND_USER', 'case.finalize')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
