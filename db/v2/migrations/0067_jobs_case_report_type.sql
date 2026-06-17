-- 0067_jobs_case_report_type.sql — add CASE_REPORT to the jobs.type CHECK (ADR-0041 S5 slice 2b).
-- The case-level client report (PDF) is a user-initiated, awaited, downloadable artifact — the exact
-- shape of an EXPORT job (PENDING→RUNNING→SUCCEEDED|FAILED, progress, result={storageKey,filename},
-- presigned-URL download, bell notification). So it reuses the jobs engine rather than a bespoke
-- queue (unlike the fire-and-forget reverse-geocode queue). Forward-only, idempotent.

BEGIN;

ALTER TABLE jobs DROP CONSTRAINT IF EXISTS chk_jobs_type;
ALTER TABLE jobs ADD  CONSTRAINT chk_jobs_type CHECK (type IN ('EXPORT', 'IMPORT', 'CASE_REPORT'));

COMMIT;
