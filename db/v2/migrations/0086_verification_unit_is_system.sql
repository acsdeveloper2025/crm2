-- 0086_verification_unit_is_system.sql — mark the mobile-hardcoded field-visit units as SYSTEM-locked.
-- The field app (crm-mobile-native) hardcodes a per-type verification form endpoint + renderer for each
-- of the 9 FIELD_VISIT units (residence / office / residence-cum-office / business / builder / noc /
-- dsa-connector / property-apf / property-individual). Renaming, reconfiguring, or deactivating one of
-- those rows would silently break field submission, so they must not be editable in the admin UI. This
-- adds an `is_system` flag and back-fills it for those 9 codes (KYC document units stay editable).
-- Additive, idempotent, re-run-safe. The seed (verification_units.seed.sql) re-asserts the flag every
-- deploy AFTER the rows are inserted (fresh installs); this back-fill covers an already-seeded prod.
BEGIN;

ALTER TABLE verification_units ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false;

UPDATE verification_units SET is_system = true
WHERE NOT is_system
  AND kind = 'FIELD_VISIT'
  AND code IN ('RESIDENCE', 'OFFICE', 'RESIDENCE_CUM_OFFICE', 'BUSINESS', 'BUILDER', 'NOC',
               'DSA_CONNECTOR', 'PROPERTY_APF', 'PROPERTY_INDIVIDUAL');

COMMIT;
