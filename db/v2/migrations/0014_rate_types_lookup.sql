-- 0014_rate_types_lookup.sql — managed rate-type list for the Rate Management dropdown (owner).
-- Rate type is a selectable DB list (not free text): Local/OGL/Outstation + 5 numbered variants
-- each. rates.rate_type stays a varchar that stores the chosen code (snapshot). This table only
-- supplies the dropdown options. Forward-only, idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS rate_types (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code       varchar(40) NOT NULL,
  sort_order integer     NOT NULL DEFAULT 0,
  is_active  boolean     NOT NULL DEFAULT true,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_rate_types_code UNIQUE (code)
);

INSERT INTO rate_types (code, sort_order) VALUES
  ('LOCAL', 10), ('LOCAL1', 11), ('LOCAL2', 12), ('LOCAL3', 13), ('LOCAL4', 14), ('LOCAL5', 15),
  ('OGL', 20), ('OGL1', 21), ('OGL2', 22), ('OGL3', 23), ('OGL4', 24), ('OGL5', 25),
  ('OUTSTATION', 30), ('OUTSTATION1', 31), ('OUTSTATION2', 32), ('OUTSTATION3', 33),
  ('OUTSTATION4', 34), ('OUTSTATION5', 35)
ON CONFLICT (code) DO NOTHING;

COMMIT;
