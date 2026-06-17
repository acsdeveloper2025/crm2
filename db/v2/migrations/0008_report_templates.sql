-- 0008_report_templates.sql — authored report templates (admin Templates screen).
-- The authoring surface for report bodies the report engine will later render
-- (Handlebars/text → PDF, built in the reports/operations phase). Templates are keyed
-- by the same `template_type` the verification_units registry already carries
-- (FIELD_NARRATIVE / KYC_DOCUMENT), so the future engine resolves a unit's
-- reportTemplateType → the active template's content. CPV-scoped overrides
-- (client+product+vtype) are a deferred reports-phase enhancement.
-- Forward-only, idempotent.

CREATE TABLE IF NOT EXISTS report_templates (
  id            serial PRIMARY KEY,
  code          varchar(50)  NOT NULL,
  name          varchar(150) NOT NULL,
  template_type varchar(30)  NOT NULL,
  content       text         NOT NULL DEFAULT '',
  is_active     boolean      NOT NULL DEFAULT true,
  created_by    uuid,
  updated_by    uuid,
  created_at    timestamptz  NOT NULL DEFAULT now(),
  updated_at    timestamptz  NOT NULL DEFAULT now(),
  CONSTRAINT uq_report_templates_code UNIQUE (code),
  CONSTRAINT chk_report_template_type CHECK (template_type IN ('FIELD_NARRATIVE', 'KYC_DOCUMENT'))
);

CREATE INDEX IF NOT EXISTS idx_report_templates_type ON report_templates (template_type);
CREATE INDEX IF NOT EXISTS idx_report_templates_active ON report_templates (is_active);
