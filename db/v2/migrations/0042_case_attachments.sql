-- 0042_case_attachments.sql — office-uploaded reference attachments (ADR-0025 B2; ADR-0021 storage).
-- The "ATTACHMENT" flow ONLY (NOT field photo-capture evidence): a back-office user uploads a
-- document (PDF/image) to a case or a specific task; the assignee (field agent OR KYC verifier) and
-- scoped users READ it. For a KYC/desk task this is the document the verifier downloads to verify.
--   case_id        — the owning case (cascade-deleted with the case)
--   task_id        — NULL = case-level reference; set = task-level (the field/KYC task it belongs to)
--   storage_key    — opaque object-store key (ADR-0021 getStorage); bytes never touch Postgres
--   uploaded_by    — plain uuid (no FK; actor-column convention, like completed_by/created_by)
--   deleted_at     — soft delete (DPDP erasure); every read filters deleted_at IS NULL
-- Forward-only, idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS case_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id       uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  task_id       uuid REFERENCES case_tasks(id) ON DELETE CASCADE,
  original_name varchar(255) NOT NULL,
  mime_type     varchar(100) NOT NULL,
  file_size     integer NOT NULL,
  storage_key   text NOT NULL,
  sha256        text NOT NULL,
  uploaded_by   uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  deleted_at    timestamptz
);

CREATE INDEX IF NOT EXISTS idx_case_attachments_case ON case_attachments (case_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_case_attachments_task ON case_attachments (task_id) WHERE deleted_at IS NULL;

COMMIT;
