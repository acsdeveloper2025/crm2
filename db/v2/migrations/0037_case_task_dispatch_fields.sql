-- 0037_case_task_dispatch_fields.sql — Case-creation dispatch parity (ADR-0023;
-- docs/specs/2026-06-11-case-creation-and-pipeline-model-design.md §2/§3).
-- Adds the fields the unmodified field mobile app reads from /sync/download (the locked
-- dispatch contract, audit §3) into their v2-native home — WITHOUT changing the frozen
-- Case→Task→VU model. Each task now targets ONE applicant (drives customerName/phone/type),
-- and carries its own address, trigger (device `notes`), priority, and a display task number.
-- Status enum gains SUBMITTED_FOR_REVIEW + REVOKED (the later ingest/review legs).
-- Forward-only, idempotent. Existing dev rows are disposable seed → placeholder-backfilled
-- before the NOT NULL constraints are set.

BEGIN;

-- (1) cases: required office contact the field agent calls (FE prefills from creator phone).
ALTER TABLE cases ADD COLUMN IF NOT EXISTS backend_contact_number varchar(20);
UPDATE cases SET backend_contact_number = '0000000000' WHERE backend_contact_number IS NULL;
ALTER TABLE cases ALTER COLUMN backend_contact_number SET NOT NULL;

-- (2) case_applicants: per-applicant call-routing token (v1 parity; display-only). App
--     generates 'CC-<epoch>-<rand>' on new inserts; existing dev rows get a legacy stamp.
ALTER TABLE case_applicants ADD COLUMN IF NOT EXISTS calling_code varchar(40);
UPDATE case_applicants SET calling_code = 'CC-' || substr(replace(id::text, '-', ''), 1, 12)
 WHERE calling_code IS NULL;
ALTER TABLE case_applicants ALTER COLUMN calling_code SET NOT NULL;

-- (3) case_tasks: the task targets exactly one applicant of its own case.
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS applicant_id uuid REFERENCES case_applicants(id);
UPDATE case_tasks ct
   SET applicant_id = (SELECT a.id FROM case_applicants a
                        WHERE a.case_id = ct.case_id AND a.is_primary)
 WHERE ct.applicant_id IS NULL;
ALTER TABLE case_tasks ALTER COLUMN applicant_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_case_tasks_applicant ON case_tasks (applicant_id);

-- (4) case_tasks: free-text dispatch address (the agent navigates by it).
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS address text;
UPDATE case_tasks SET address = '' WHERE address IS NULL;
ALTER TABLE case_tasks ALTER COLUMN address SET NOT NULL;

-- (5) case_tasks: per-task bank instruction → device `notes` (fixes v1's case-vs-task split).
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS trigger text NOT NULL DEFAULT '';

-- (6) case_tasks: per-task priority.
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS priority varchar(10) NOT NULL DEFAULT 'MEDIUM';
ALTER TABLE case_tasks DROP CONSTRAINT IF EXISTS chk_case_task_priority;
ALTER TABLE case_tasks ADD CONSTRAINT chk_case_task_priority
  CHECK (priority IN ('LOW', 'MEDIUM', 'HIGH', 'URGENT'));

-- (7) case_tasks: display task number = case_number || '-' || per-case ordinal (owner choice;
--     device only displays it, never parses). Unique within a case.
ALTER TABLE case_tasks ADD COLUMN IF NOT EXISTS task_number varchar(30);
UPDATE case_tasks ct
   SET task_number = c.case_number || '-' || sub.rn
  FROM (SELECT id, case_id,
               row_number() OVER (PARTITION BY case_id ORDER BY created_at, id) AS rn
          FROM case_tasks) sub
  JOIN cases c ON c.id = sub.case_id
 WHERE ct.id = sub.id AND ct.task_number IS NULL;
ALTER TABLE case_tasks ALTER COLUMN task_number SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_case_task_number ON case_tasks (case_id, task_number);

-- (8) case_tasks: extend the status enum (ingest/review legs land later; migrate once).
-- Re-run safety (the prod migrate re-applies EVERY file in order each deploy): this list must be a
-- SUPERSET of every status the live data may hold by the time this file re-runs. ADR-0047 (0081) later
-- introduces 'SUBMITTED' and the app writes it; since 0037 re-runs BEFORE 0081, omitting 'SUBMITTED'
-- here makes ADD CONSTRAINT reject live SUBMITTED rows ("violated by some row") and aborts the deploy.
-- So 'SUBMITTED' is included here too (0081 narrows it to the final set, dropping the vestigial SFR).
ALTER TABLE case_tasks DROP CONSTRAINT IF EXISTS chk_case_task_status;
ALTER TABLE case_tasks ADD CONSTRAINT chk_case_task_status CHECK (
  status IN ('PENDING', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'SUBMITTED_FOR_REVIEW',
             'COMPLETED', 'REVOKED', 'CANCELLED')
);

COMMIT;
