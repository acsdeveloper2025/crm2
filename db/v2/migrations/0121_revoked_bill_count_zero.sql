-- 0121_revoked_bill_count_zero.sql — a REVOKED task carries no billable units (§REVOKE-BILLING).
--
-- Owner (2026-07-18, from prod CASE-000004): the revoked row still showed BILL = 1 next to its
-- replacement's 1 — a phantom unit on the case grid and MIS. Billing itself never reads it (lines are
-- COMPLETED-only), but bill_count is a displayed multiplier and must reflect reality: revoked work is
-- unbilled. `revokeTaskInPlace` now sets bill_count = 0 at revoke; this backfills rows revoked before
-- that change. The assign-time value is preserved in task_assignment_history.

BEGIN;

UPDATE case_tasks SET bill_count = 0 WHERE status = 'REVOKED' AND bill_count <> 0;

COMMIT;
