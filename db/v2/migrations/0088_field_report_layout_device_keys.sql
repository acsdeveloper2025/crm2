-- 0088_field_report_layout_device_keys.sql — correct stale FIELD_REPORT layout column source_refs.
--
-- A FIELD_REPORT layout's narrative is rendered with the layout's OWN stored columns
-- (`fieldReports/service.ts` renderNarrative(layout.templateBody, layout.columns, ...)), NOT the live
-- default catalog. Each column SNAPSHOTS its device-key `source_ref` at creation. The 2026-06-24
-- v2-native device-key corrections (residence/RCO floor read `addressFloor` not `applicantStayingFloor`;
-- business & RCO area read `officeApproxArea` not `approxArea`) fixed the DEFAULT catalog + the
-- raw-sections map — but any FIELD_REPORT layout created BEFORE that carries the OLD keys and renders an
-- empty/wrong value for v2 device submissions. This remaps the known drifts on existing stored columns.
--
-- Slug-scoped: RESIDENCE legitimately emits `approxArea` (only business + residence-cum-office drifted to
-- `officeApproxArea`). Floor is universal — only residence + residence-cum-office ever used
-- `applicantStayingFloor`, and the v2 device never emits that key (it sends `addressFloor`).
--
-- Additive data-correction only (UPDATE, no DDL): re-run-safe — a re-run matches zero rows and is a
-- no-op, so it can never become a migrate-rerun deploy blocker (cf. the 0037/0083 rename traps).
BEGIN;

-- Floor: residence + residence-cum-office. Device emits `addressFloor`; no `applicantStayingFloor` field
-- exists in the v2 form. (`ordinal('')` on the empty old key was fabricating a wrong "0th floor".)
UPDATE report_layout_columns
   SET source_ref = replace(source_ref, '.formData.applicantStayingFloor', '.formData.addressFloor')
 WHERE source_ref LIKE '%.formData.applicantStayingFloor';

-- Area: business + residence-cum-office device forms emit `officeApproxArea` (residence emits
-- `approxArea`, which is correct and left untouched).
UPDATE report_layout_columns
   SET source_ref = 'business.formData.officeApproxArea'
 WHERE source_ref = 'business.formData.approxArea';

UPDATE report_layout_columns
   SET source_ref = 'residence-cum-office.formData.officeApproxArea'
 WHERE source_ref = 'residence-cum-office.formData.approxArea';

COMMIT;
