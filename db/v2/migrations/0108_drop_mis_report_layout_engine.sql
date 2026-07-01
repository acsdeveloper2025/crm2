-- 0108_drop_mis_report_layout_engine.sql — remove the MIS / report-layout / office data-entry engine
-- (ADR-0083, supersedes ADR-0037 / ADR-0049). Owner 2026-07-01: the "MIS Layout" system had grown a
-- confusing set of sub-kinds (DATA_ENTRY / MIS / BILLING_MIS / FIELD_REPORT / CASE_REPORT) behind one
-- "MIS Layouts" designer; it is being torn out wholesale to be rebuilt fresh with a proper design.
--
-- What goes:
--   * report_layouts + report_layout_columns (mig 0060/0064/0066) — the whole layout store, ALL kinds.
--   * case_data_entries (mig 0061/0062) + case_pickups (mig 0063) — office data-entry keying + pickup.
--   * the page.mis (0082), data_entry.manage (0061/0063) and report_template.manage role_permissions.
--
-- Survivors (fieldReports/caseReports) were decoupled in code: they no longer read report_layouts and
-- always render from the built-in FIELD_REPORT_DEFAULTS / DEFAULT_CASE_REPORT_TEMPLATE — the exact
-- "no layout configured" path prod already used exclusively (zero report_layouts rows ever existed).
--
-- Re-run-safe under the every-deploy re-apply model: 0060–0066/0082 all run BEFORE this file (creating
-- then this drops), same pattern as 0091 retiring report_templates. CASCADE drops the FK from
-- case_data_entries.layout_id and the report_layout_columns.layout_id ON DELETE CASCADE constraint.
-- Forward-only, idempotent.

BEGIN;

-- 1) Permissions — the three perms that only ever gated the removed pages/endpoints.
DELETE FROM role_permissions
 WHERE permission_code IN ('page.mis', 'data_entry.manage', 'report_template.manage');

-- 2) Office data-entry (keying + pickup) — depends on report_layouts via case_data_entries.layout_id.
DROP TABLE IF EXISTS case_pickups CASCADE;
DROP TABLE IF EXISTS case_data_entries CASCADE;

-- 3) The layout store itself (columns child first for clarity; CASCADE covers the FK either way).
DROP TABLE IF EXISTS report_layout_columns CASCADE;
DROP TABLE IF EXISTS report_layouts CASCADE;

COMMIT;
