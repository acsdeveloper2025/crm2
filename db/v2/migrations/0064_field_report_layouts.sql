-- 0064_field_report_layouts.sql — extend report_layouts for the FIELD_REPORT template engine
-- (ADR-0039, template-report engine slice 1). Adds the Handlebars narrative `template_body` + the
-- per-verification-type key so a (client,product) can have ONE active FIELD_REPORT per verification
-- type (the field unit code, e.g. RESIDENCE/OFFICE), alongside the existing single
-- DATA_ENTRY/MIS/BILLING_MIS layouts. A FIELD_REPORT layout's columns act as its VARIABLE CATALOG
-- (each column_key is a Handlebars variable, source-bound via SOURCE_CATALOG). verification_type is a
-- free string (not enum-constrained) so the engine extends to KYC verification types later with no
-- schema change (ADR-0038). Forward-only, idempotent.

BEGIN;

ALTER TABLE report_layouts ADD COLUMN IF NOT EXISTS template_body     text;
ALTER TABLE report_layouts ADD COLUMN IF NOT EXISTS verification_type varchar(64);

-- widen the kind enum to include FIELD_REPORT
ALTER TABLE report_layouts DROP CONSTRAINT IF EXISTS report_layouts_kind_check;
ALTER TABLE report_layouts ADD  CONSTRAINT report_layouts_kind_check
  CHECK (kind IN ('DATA_ENTRY', 'MIS', 'BILLING_MIS', 'FIELD_REPORT'));

-- coherence: FIELD_REPORT carries a verification_type + template_body; the other kinds carry neither.
ALTER TABLE report_layouts DROP CONSTRAINT IF EXISTS chk_report_layouts_field_report;
-- `verification_type <> ''` is load-bearing: an empty string would COALESCE to '' and collide with the
-- type-less slot in uq_report_layouts_active (app layer also guards via Zod .min(1), DB is the backstop).
ALTER TABLE report_layouts ADD  CONSTRAINT chk_report_layouts_field_report CHECK (
  CASE WHEN kind = 'FIELD_REPORT'
       THEN verification_type IS NOT NULL AND verification_type <> '' AND template_body IS NOT NULL
       ELSE verification_type IS NULL     AND template_body IS NULL
  END
);

-- one active layout per (client, product, kind, verification_type). COALESCE preserves the existing
-- one-active-per-(client,product,kind) guarantee for the type-less kinds (verification_type = '').
DROP INDEX IF EXISTS uq_report_layouts_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_layouts_active
  ON report_layouts (client_id, product_id, kind, COALESCE(verification_type, '')) WHERE is_active;

COMMIT;
