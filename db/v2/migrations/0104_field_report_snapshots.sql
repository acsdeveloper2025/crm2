-- 0104_field_report_snapshots.sql — per-task FIELD_REPORT snapshot, frozen at field submission (ADR-0080).
--
-- The device's "Submit Verification" renders the field narrative ONCE and stores it here: an immutable,
-- point-in-time record of the agent's report. The field-report endpoint returns this snapshot when it
-- exists, so a LATER template edit (or a correction to the standard defaults) never rewrites an
-- already-submitted task's report. One row per task — a resubmit before completion UPSERTs (the latest
-- submission wins). The layout id/name are DENORMALISED (no FK) so the snapshot is self-contained even if
-- the report_layouts row is later changed or deactivated. Inputs (form_data, photos) stay on case_tasks.
BEGIN;

CREATE TABLE IF NOT EXISTS field_reports (
  id                integer     GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_task_id      uuid        NOT NULL UNIQUE REFERENCES case_tasks (id) ON DELETE CASCADE,
  verification_type varchar(40) NOT NULL,
  outcome           varchar(120),                 -- the device outcome at submission (evidence; metadata)
  narrative         text        NOT NULL,          -- the rendered field-report narrative, frozen
  layout_id         integer,                       -- the FIELD_REPORT layout that produced it; NULL = the standard built-in default
  layout_name       varchar(150),
  rendered_by       uuid,                          -- the field agent whose submission froze it
  rendered_at       timestamptz NOT NULL DEFAULT now()
);

COMMIT;
