-- 0062_case_data_entries_case_grain.sql — re-grain office data-entry from per-task to per-CASE
-- (ADR-0037 correction). Zion `NewDataQC` keys the structured MIS fields once PER CASE (the documents
-- /verifications are a grid within the case page), not per task; the MIS layout grain is per
-- (client,product), applied at the case level. The slice-3a per-task `case_data_entries` held only
-- test data (no prod v2 DB) → drop + recreate at case grain. `uq(case_id)` = one data-entry per case.
-- The immutable-once-used guard (reportLayouts) still keys off `layout_id` (grain-agnostic). OCC
-- `version` per ADR-0019. Forward-only, idempotent.

BEGIN;

DROP TABLE IF EXISTS case_data_entries;

CREATE TABLE case_data_entries (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id    uuid        NOT NULL REFERENCES cases (id),
  layout_id  integer     NOT NULL REFERENCES report_layouts (id),
  data       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  version    integer     NOT NULL DEFAULT 1,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_case_data_entries_case UNIQUE (case_id)
);

-- the immutable-once-used guard checks "does this layout have any keyed data?" → index by layout
CREATE INDEX IF NOT EXISTS idx_case_data_entries_layout ON case_data_entries (layout_id);

COMMIT;
