-- 0014_rate_types_lookup.sql — managed rate-type list for the Rate Management dropdown (owner).
-- Rate type is a selectable DB list (not free text): Local/OGL/Outstation + 5 numbered variants
-- each. rates.rate_type stays a varchar that stores the chosen code (snapshot). This table only
-- supplies the dropdown options. Forward-only, idempotent.

BEGIN;

-- `name` is added here (nullable; 0092 makes it NOT NULL) and seeded = code. Phase C (ADR-0068) guards
-- 0013's `DROP TABLE rate_types CASCADE` so the managed catalog now PERSISTS across deploys (was wiped +
-- id-reset every deploy). With the table persistent + name NOT NULL (0092), a nameless re-seed here would
-- violate the NOT NULL (ON CONFLICT only suppresses the code conflict, not a NULL-name violation) — so the
-- seed must supply name. On a re-run the codes already exist → ON CONFLICT DO NOTHING (the names are moot).
CREATE TABLE IF NOT EXISTS rate_types (
  id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  code       varchar(40) NOT NULL,
  name       varchar(100),
  sort_order integer     NOT NULL DEFAULT 0,
  is_active  boolean     NOT NULL DEFAULT true,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_rate_types_code UNIQUE (code)
);

INSERT INTO rate_types (code, name, sort_order) VALUES
  ('LOCAL', 'LOCAL', 10), ('LOCAL1', 'LOCAL1', 11), ('LOCAL2', 'LOCAL2', 12), ('LOCAL3', 'LOCAL3', 13),
  ('LOCAL4', 'LOCAL4', 14), ('LOCAL5', 'LOCAL5', 15),
  ('OGL', 'OGL', 20), ('OGL1', 'OGL1', 21), ('OGL2', 'OGL2', 22), ('OGL3', 'OGL3', 23),
  ('OGL4', 'OGL4', 24), ('OGL5', 'OGL5', 25),
  ('OUTSTATION', 'OUTSTATION', 30), ('OUTSTATION1', 'OUTSTATION1', 31), ('OUTSTATION2', 'OUTSTATION2', 32),
  ('OUTSTATION3', 'OUTSTATION3', 33), ('OUTSTATION4', 'OUTSTATION4', 34), ('OUTSTATION5', 'OUTSTATION5', 35)
ON CONFLICT (code) DO NOTHING;

COMMIT;
