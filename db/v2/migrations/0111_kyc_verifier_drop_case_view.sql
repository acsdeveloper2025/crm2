-- 0111 — KYC verifier: drop case.view (ADR-0085, owner 2026-07-02).
-- The read-only KYC verifier should NEVER open the full case/task detail page — his job is the KYC
-- queue (see + export his own OFFICE tasks) and downloading HIS OWN task's reference attachments (a
-- new kyc_tasks.view-gated endpoint, not /cases/*). Removing case.view also closes his incidental
-- reach into /api/v2/cases and /api/v2/tasks (both were SELF-scoped, so no data was ever leaked —
-- this is least-privilege tidy-up). His surviving perms: page.dashboard, kyc_tasks.view,
-- kyc_tasks.export. Forward-only, idempotent, re-run-safe.

BEGIN;

DELETE FROM role_permissions WHERE role_code = 'KYC_VERIFIER' AND permission_code = 'case.view';

COMMIT;
