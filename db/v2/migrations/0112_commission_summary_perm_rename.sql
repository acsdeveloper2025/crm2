-- 0112_commission_summary_perm_rename.sql — ADR-0086: separate Billing from Commission.
-- Rename the commission-summary permission OUT of the `billing.` namespace:
--   billing.commission_summary.view  ->  commission_summary.view
-- GRANT-CARRY: a single in-place UPDATE renames the code on role_permissions, so every role that holds
-- it (MANAGER, BACKEND_USER; SUPER_ADMIN via grants_all needs no row) keeps it under the new code — no
-- INSERT/DELETE, no window where any role loses access. `billing.view` is deliberately UNTOUCHED (it
-- remains the platform money-gate for the Pipeline + MIS read-models). Mirrors @crm2/access PERMISSIONS
-- + ROLE_PERMISSIONS (roles-parity-tested). Forward-only, idempotent, re-run-safe (a second run matches
-- zero old rows).

BEGIN;

UPDATE role_permissions
   SET permission_code = 'commission_summary.view'
 WHERE permission_code = 'billing.commission_summary.view';

COMMIT;
