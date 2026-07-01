-- 0106_case_tasks_verification_unit_index.sql — index case_tasks.verification_unit_id (DATABASE-01,
-- docs/audit/11-database.md).
--
-- The FK column (0010_cases.sql) never got a supporting index despite being a live Pipeline task-list
-- filter (apps/api/src/modules/tasks/repository.ts:134, `WHERE ct.verification_unit_id = $N`) and a
-- join key used repeatedly in the same file (verification_units, user_kyc_units).
BEGIN;

CREATE INDEX IF NOT EXISTS idx_case_tasks_verification_unit ON case_tasks (verification_unit_id);

COMMIT;
