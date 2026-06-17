-- 0061_case_data_entries.sql — office data-entry values per task (ADR-0037, MIS engine slice 3a).
-- An office operator keys the structured MIS fields for a task against its CPV's active DATA_ENTRY
-- layout (report_layouts kind=DATA_ENTRY). One record per task; `data` is a jsonb map keyed by the
-- layout's column_key. `layout_id` records WHICH layout the values were keyed against — this is also
-- what makes that layout "in use" (the slice-1 immutable-once-used guard: a DATA_ENTRY layout that
-- has keyed data can be renamed but not structurally re-columned). OCC `version` per ADR-0019.
-- Plus the `data_entry.manage` permission (office roles: MANAGER + BACKEND_USER; SA via grants_all).
-- Forward-only, idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS case_data_entries (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  task_id    uuid        NOT NULL REFERENCES case_tasks (id),
  layout_id  integer     NOT NULL REFERENCES report_layouts (id),
  data       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  version    integer     NOT NULL DEFAULT 1,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_case_data_entries_task UNIQUE (task_id)
);

-- the immutable-once-used guard checks "does this layout have any keyed data?" → index by layout
CREATE INDEX IF NOT EXISTS idx_case_data_entries_layout ON case_data_entries (layout_id);

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',      'data_entry.manage'),
  ('BACKEND_USER', 'data_entry.manage')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
