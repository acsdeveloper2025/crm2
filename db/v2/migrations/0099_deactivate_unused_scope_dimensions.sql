-- 0099_deactivate_unused_scope_dimensions.sql — ADR-0072 (amends ADR-0022). Reduce the user-access scope
-- catalog to CLIENT + PRODUCT (+ PINCODE/AREA = field-agent territory) by DEACTIVATING the three dimensions
-- that were selectable but wired to no system role: STATE, CITY, VERIFICATION_TYPE (COMPLIANCE SR-8/SR-10).
--
-- Zero access change: a user_scope_assignment can only be created for a dimension wired to the user's role
-- (the add/import path validates against role_scope_dimensions + the code registry), and these 3 are wired
-- to no role — so no ACTIVE assignment can exist for them. Every scope reader (resolver, role-dimension feed,
-- assignment list/export, role-editor catalog) filters is_active, so deactivating the catalog rows removes
-- them everywhere. Rows are deactivated (not deleted) → audit trail preserved, re-activatable.
--
-- UPDATE-only (no DDL → no ACCESS EXCLUSIVE, no rolling-deploy lock risk → no lock-retry preamble needed).
-- Idempotent: the `AND is_active` guard makes a re-run touch 0 rows.

BEGIN;

UPDATE scope_dimensions
   SET is_active = false
 WHERE code IN ('STATE', 'CITY', 'VERIFICATION_TYPE') AND is_active;

-- Defensive (0 expected — see header): drop any stray role wiring / user assignment for the 3.
UPDATE role_scope_dimensions
   SET is_active = false
 WHERE dimension_code IN ('STATE', 'CITY', 'VERIFICATION_TYPE') AND is_active;

UPDATE user_scope_assignments
   SET is_active = false
 WHERE dimension_code IN ('STATE', 'CITY', 'VERIFICATION_TYPE') AND is_active;

COMMIT;
