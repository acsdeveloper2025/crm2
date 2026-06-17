-- 0066_case_report_layouts.sql — extend report_layouts for the CASE_REPORT engine
-- (ADR-0041, S5 slice 1). Adds the CASE_REPORT layout kind alongside DATA_ENTRY/MIS/BILLING_MIS/
-- FIELD_REPORT. CASE_REPORT is the case-level downloadable client report (PDF/Word/Excel); its body
-- is a Handlebars HTML template rendered against the CaseReportContext (per-task FIELD_REPORT
-- narratives + photos with frozen reverse_geocoded_address + case identity + totals). Two new shape
-- columns hold the page geometry (used by the PDF renderer in slice 3). Required for CASE_REPORT, null
-- for the other kinds. Forward-only, idempotent.

BEGIN;

ALTER TABLE report_layouts ADD COLUMN IF NOT EXISTS page_size        varchar(10);
ALTER TABLE report_layouts ADD COLUMN IF NOT EXISTS page_orientation varchar(10);

-- widen the kind enum to include CASE_REPORT
ALTER TABLE report_layouts DROP CONSTRAINT IF EXISTS report_layouts_kind_check;
ALTER TABLE report_layouts ADD  CONSTRAINT report_layouts_kind_check
  CHECK (kind IN ('DATA_ENTRY', 'MIS', 'BILLING_MIS', 'FIELD_REPORT', 'CASE_REPORT'));

-- coherence: CASE_REPORT carries (template_body + page_size + page_orientation) and NO
-- verification_type. FIELD_REPORT keeps its existing (verification_type + template_body) shape and
-- still rejects page_size/orientation. The remaining kinds (DATA_ENTRY/MIS/BILLING_MIS) carry no
-- template_body / verification_type / page geometry — the column-driven engines stay column-driven.
ALTER TABLE report_layouts DROP CONSTRAINT IF EXISTS chk_report_layouts_field_report;
-- the new name too — keeps the migration re-runnable against an already-0066 DB (DB FLAG, panel 06-17).
ALTER TABLE report_layouts DROP CONSTRAINT IF EXISTS chk_report_layouts_shape;
ALTER TABLE report_layouts ADD  CONSTRAINT chk_report_layouts_shape CHECK (
  CASE
    WHEN kind = 'FIELD_REPORT'
      THEN verification_type IS NOT NULL AND verification_type <> '' AND template_body IS NOT NULL
           AND page_size IS NULL AND page_orientation IS NULL
    WHEN kind = 'CASE_REPORT'
      THEN verification_type IS NULL
           AND template_body IS NOT NULL
           AND page_size IN ('A4','LETTER','LEGAL')
           AND page_orientation IN ('portrait','landscape')
    ELSE -- DATA_ENTRY, MIS, BILLING_MIS
      verification_type IS NULL
      AND template_body IS NULL
      AND page_size IS NULL
      AND page_orientation IS NULL
  END
);

-- The existing uq_report_layouts_active (client_id, product_id, kind, COALESCE(verification_type,''))
-- WHERE is_active already enforces one active CASE_REPORT per (client, product) — verification_type
-- is null so COALESCE collapses to '' and the unique key holds.

COMMIT;
