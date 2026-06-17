-- 0035_worker_role_fk.sql — Access Control 2.0 slice 4 (ADR-0022): verification_units.worker_role
-- joins the open role catalog. The inline CHECK (worker_role IN ('FIELD_AGENT','KYC_VERIFIER'))
-- becomes an FK to roles(code), so an admin-created custom role can be a unit's worker without a
-- code change. The kind-profile invariants (chk_vu_field_visit / chk_vu_kyc_document) REMAIN —
-- FIELD_VISIT/KYC_DOCUMENT keep their pinned operational profiles (ADR-0001); the open-ended kind
-- (DESK_DOCUMENT) may target any role. Forward-only, idempotent.

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'verification_units_worker_role_check'
      AND conrelid = 'verification_units'::regclass
  ) THEN
    ALTER TABLE verification_units DROP CONSTRAINT verification_units_worker_role_check;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_vu_worker_role') THEN
    ALTER TABLE verification_units
      ADD CONSTRAINT fk_vu_worker_role FOREIGN KEY (worker_role) REFERENCES roles (code);
  END IF;
END $$;
