-- 0097_drop_verification_unit_kind.sql — ADR-0070 (supersedes the kind discriminator in ADR-0001/0002).
-- Remove verification_units.kind; `worker_role` becomes the single discriminator. kind was 1:1 with
-- worker_role for all live data (FIELD_VISIT⟺FIELD_AGENT, KYC_DOCUMENT⟺KYC_VERIFIER); DESK_DOCUMENT was
-- dead (0 rows, never creatable). The two cross-field invariants re-key from kind to worker_role — the
-- profile checks are byte-identical, only the antecedent changes. Task visit_type now derives from
-- worker_role (sdk visitTypeForRole), not kind.
--
-- Applies ONCE via the tracked runner (db/v2/migrate.sh, shipped b96a418): the earlier kind-referencing
-- migrations (0001/0086) never re-run, so no guarding is needed. Still written idempotent
-- (DROP IF EXISTS → DROP COLUMN IF EXISTS → re-ADD) for the edited-migration + fresh-apply paths.

BEGIN;

-- Drop the kind-keyed invariants + index, then the column (the constraints reference kind, so drop first).
ALTER TABLE verification_units DROP CONSTRAINT IF EXISTS chk_vu_field_visit;
ALTER TABLE verification_units DROP CONSTRAINT IF EXISTS chk_vu_kyc_document;
DROP INDEX IF EXISTS idx_verification_units_kind;
ALTER TABLE verification_units DROP COLUMN IF EXISTS kind;

-- Re-add the same invariants, keyed on worker_role instead of kind.
ALTER TABLE verification_units ADD CONSTRAINT chk_vu_field_visit CHECK (
    worker_role <> 'FIELD_AGENT' OR (
        required_photos >= 5 AND required_gps = true
        AND required_form_code IS NOT NULL AND billing_profile = 'AGENT_COMMISSION'
        AND report_template_type = 'FIELD_NARRATIVE' AND reverification_rule = 'REVISIT_PARENT_RATE'
    )
);
ALTER TABLE verification_units ADD CONSTRAINT chk_vu_kyc_document CHECK (
    worker_role <> 'KYC_VERIFIER' OR (
        required_photos = 0 AND required_gps = false
        AND billing_profile = 'CLIENT_INVOICE' AND commission_profile = 'NONE'
        AND report_template_type = 'KYC_DOCUMENT' AND reverification_rule = 'RECHECK_FRESH_RATE'
    )
);

COMMIT;
