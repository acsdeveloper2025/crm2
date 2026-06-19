-- 0081_case_tasks_submitted.sql — real SUBMITTED task status (field-done) + submit timestamps (ADR-0047).
-- Supersedes the submit==complete leg of ADR-0032: the device form-submit now lands the task in
-- SUBMITTED (field executive's terminal; field commission frozen here) rather than COMPLETED, and the
-- office adds report+result to reach COMPLETED (client bill). SUBMITTED REPLACES the vestigial
-- SUBMITTED_FOR_REVIEW (no path ever wrote it). submitted_at / submitted_elapsed_minutes mirror
-- completed_at / completed_elapsed_minutes (stamped at submit) and drive the field-commission anchor +
-- submit-in TAT band (ADR-0046 §4) + the mobile "Submitted" tab. Forward-only, idempotent.

BEGIN;

-- Safety: the CHECK can only DROP 'SUBMITTED_FOR_REVIEW' if nothing holds it (it is vestigial on this
-- deployment — submit==complete never produced it). Abort loudly rather than silently if any row does.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM case_tasks WHERE status = 'SUBMITTED_FOR_REVIEW') THEN
    RAISE EXCEPTION 'ADR-0047: % case_tasks hold SUBMITTED_FOR_REVIEW; migrate them to SUBMITTED before narrowing the CHECK',
      (SELECT count(*) FROM case_tasks WHERE status = 'SUBMITTED_FOR_REVIEW');
  END IF;
END $$;

ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS submitted_at timestamptz;
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS submitted_elapsed_minutes integer;

ALTER TABLE case_tasks DROP CONSTRAINT IF EXISTS chk_case_task_status;
ALTER TABLE case_tasks ADD CONSTRAINT chk_case_task_status CHECK (
  status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'REVOKED', 'CANCELLED'));

COMMIT;
