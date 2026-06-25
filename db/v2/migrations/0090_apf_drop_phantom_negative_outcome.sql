-- 0090_apf_drop_phantom_negative_outcome.sql — PROPERTY_APF has no top-level NEGATIVE outcome (A2026-0623-07).
-- v1 captures an APF negative RESULT via the construction-activity routing inside the single APF form
-- (SEEN → positive verdict; STOP / VACANT → negative verdict on `finalStatus` / `finalStatusNegative`),
-- NOT a separate NEGATIVE outcome/form. The device form catalog (LegacyFormTemplateBuilders.ts) has no
-- NEGATIVE APF form either. So the reference feed (mig 0069) advertising a phantom 'NEGATIVE' APF outcome
-- is a leftover: once the mobile outcome-sync is fixed (A2026-0623-02), the device picker would offer
-- NEGATIVE with no form behind it. Drop it and re-number the remaining outcomes contiguously so the feed
-- matches the device + v1. The backend report still renders a negative verdict from finalStatus (no report
-- change). Forward-only, idempotent.
BEGIN;

DELETE FROM verification_unit_outcomes
WHERE verification_type_code = 'PROPERTY_APF' AND outcome_code = 'NEGATIVE';

UPDATE verification_unit_outcomes SET sort_order = 2
WHERE verification_type_code = 'PROPERTY_APF' AND outcome_code = 'ENTRY_RESTRICTED';
UPDATE verification_unit_outcomes SET sort_order = 3
WHERE verification_type_code = 'PROPERTY_APF' AND outcome_code = 'UNTRACEABLE';

COMMIT;
