-- 0110 — KYC-verifier export workflow (ADR-0085).
-- (1) Unified KYC document fields on case_tasks — additive, nullable; FIELD tasks leave them NULL.
--     document_details = a flat label→value jsonb OBJECT (v1 parity: multi-detail types like
--     BANK_STATEMENT carry {"BANK NAME":"…","ACCOUNT NO":"…"}), rendered one-line-per-label and
--     exported one-column-per-label (never flattened into one cell — owner 2026-07-02).
-- (2) Append-only task_export_events — the "exported" state is DERIVED from this ledger, never a
--     case_tasks.status (mobile shares that enum). At most ONE first-export row per task, enforced
--     by a partial unique index: the export transaction claims tasks by inserting events, so a
--     concurrent double export loses at the DB (23505 → 409 ALREADY_EXPORTED). Re-export appends
--     is_reexport=true and requires a non-blank reason. Immutable via audit_log_block_mutation() (0017).
-- (3) RBAC seed: kyc_tasks.view/export → KYC_VERIFIER (default-deny; SUPER_ADMIN via grants_all);
--     page.operations → MANAGER/TEAM_LEADER/BACKEND_USER (web-layer gate for the Pipeline + Cases
--     LIST pages; the KYC verifier's nav collapses to Dashboard + KYC verification).
-- Forward-only, idempotent, re-run-safe.

BEGIN;

ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS document_number      varchar(100);
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS document_holder_name varchar(200);
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS document_details     jsonb;
ALTER TABLE case_tasks DROP CONSTRAINT IF EXISTS chk_case_tasks_document_details_object;
ALTER TABLE case_tasks ADD CONSTRAINT chk_case_tasks_document_details_object
  CHECK (document_details IS NULL OR jsonb_typeof(document_details) = 'object');

CREATE TABLE IF NOT EXISTS task_export_events (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id         uuid        NOT NULL REFERENCES case_tasks(id) ON DELETE CASCADE,
  case_id         uuid        NOT NULL,
  exported_by     uuid        NOT NULL REFERENCES users(id),
  format          varchar(10) NOT NULL,
  is_reexport     boolean     NOT NULL DEFAULT false,
  reexport_reason text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_task_export_reason_required
    CHECK (NOT is_reexport OR length(btrim(coalesce(reexport_reason, ''))) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_task_first_export
  ON task_export_events (task_id) WHERE NOT is_reexport;
CREATE INDEX IF NOT EXISTS idx_task_export_events_task
  ON task_export_events (task_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_export_events_actor
  ON task_export_events (exported_by, created_at DESC);

DROP TRIGGER IF EXISTS trg_task_export_events_immutable ON task_export_events;
CREATE TRIGGER trg_task_export_events_immutable
  BEFORE UPDATE OR DELETE ON task_export_events
  FOR EACH ROW EXECUTE FUNCTION audit_log_block_mutation();

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('KYC_VERIFIER', 'kyc_tasks.view'),
  ('KYC_VERIFIER', 'kyc_tasks.export'),
  ('MANAGER',      'page.operations'),
  ('TEAM_LEADER',  'page.operations'),
  ('BACKEND_USER', 'page.operations')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
