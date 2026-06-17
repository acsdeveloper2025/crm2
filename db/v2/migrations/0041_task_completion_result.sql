-- 0041_task_completion_result.sql — task completion / official result columns (ADR-0025).
-- The generic task-finalize leg records the official verification result on the task itself
-- (the task is the system of record — no parallel KYC engine). Written only when a task is
-- completed via POST /cases/:id/tasks/:taskId/complete:
--   verification_outcome — the official result (POSITIVE/NEGATIVE/REFER/FRAUD)
--   remark               — the mandatory completion remark
--   completed_at / by    — who finalized it, when (BACKEND_USER under the read-only-verifier model)
-- The status CHECK already allows COMPLETED (mig 0037); no change there. The /sync/download
-- `verificationOutcome` field (today empty) reads from this column once field-review lands.
-- Mobile contract UNAFFECTED (additive, read-side). Forward-only, idempotent.

BEGIN;

ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS verification_outcome varchar(20);
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS remark text;
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS completed_at timestamptz;
-- completed_by is a plain uuid (no FK), matching assigned_by/created_by/updated_by: actor columns
-- are deliberately FK-less so the dev-auth + test-auth synthetic actor ids work. The TASK_VIEW
-- LEFT JOINs users to resolve the display name (null for a non-user uuid).
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS completed_by uuid;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_case_task_outcome') THEN
    ALTER TABLE case_tasks ADD CONSTRAINT chk_case_task_outcome
      CHECK (verification_outcome IS NULL
             OR verification_outcome IN ('POSITIVE', 'NEGATIVE', 'REFER', 'FRAUD'));
  END IF;
END $$;

COMMIT;
