-- 0060_report_layouts.sql — per-(client,product) MIS layout config (ADR-0037, MIS engine slice 1).
-- The backbone of the config-driven MIS engine: one ACTIVE layout per (client, product, kind) where
-- kind ∈ {DATA_ENTRY (office keying form), MIS (operational MIS columns), BILLING_MIS (billing
-- columns)}, plus its ordered, source-bound columns. NOT temporally resolved like `rates` (a layout
-- is selected as "the active one for this CPV+kind", not at a point in time) → no effective-dating;
-- one-active enforced by a partial unique index. OCC `version` per ADR-0019. Forward-only, idempotent.
-- Dedicated pair (NOT an extension of report_templates / mig 0008) — see ADR-0037 §1.

BEGIN;

CREATE TABLE IF NOT EXISTS report_layouts (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  client_id   integer     NOT NULL REFERENCES clients (id),
  product_id  integer     NOT NULL REFERENCES products (id),
  kind        varchar(20) NOT NULL CHECK (kind IN ('DATA_ENTRY', 'MIS', 'BILLING_MIS')),
  name        varchar(150) NOT NULL,
  is_active   boolean     NOT NULL DEFAULT true,
  version     integer     NOT NULL DEFAULT 1,
  created_by  uuid, updated_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- exactly ONE active layout per (client, product, kind)
CREATE UNIQUE INDEX IF NOT EXISTS uq_report_layouts_active
  ON report_layouts (client_id, product_id, kind) WHERE is_active;
-- lookup path: the active layout for a CPV + kind
CREATE INDEX IF NOT EXISTS idx_report_layouts_lookup
  ON report_layouts (client_id, product_id, kind);

CREATE TABLE IF NOT EXISTS report_layout_columns (
  id            integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  layout_id     integer     NOT NULL REFERENCES report_layouts (id) ON DELETE CASCADE,
  column_key    varchar(80) NOT NULL,
  header_label  varchar(150) NOT NULL,
  -- the bindable-source enum (mirrors @crm2/sdk SOURCE_TYPES — the allow-list the service validates)
  source_type   varchar(30) NOT NULL CHECK (source_type IN (
                  'TASK_FIELD', 'CASE_FIELD', 'APPLICANT_FIELD', 'RATE_AMOUNT', 'COMMISSION_AMOUNT',
                  'TAT', 'DATA_ENTRY_FIELD', 'FORM_DATA_PATH', 'DOC_TYPE_COUNT', 'COMPUTED')),
  source_ref    varchar(200),               -- bound field key / json-path / doc-type code; null for ref-less types
  data_type     varchar(20) NOT NULL CHECK (data_type IN ('TEXT', 'NUMBER', 'DATE', 'SELECT', 'BOOLEAN')),
  display_order integer     NOT NULL DEFAULT 0,
  section       varchar(80),
  is_required   boolean     NOT NULL DEFAULT false,  -- DATA_ENTRY kind: required-to-key
  options       jsonb       NOT NULL DEFAULT '[]'::jsonb,
  validation    jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_report_layout_columns_key UNIQUE (layout_id, column_key)
);

CREATE INDEX IF NOT EXISTS idx_report_layout_columns_layout
  ON report_layout_columns (layout_id, display_order);

COMMIT;
