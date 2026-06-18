-- 0077_tat_policies.sql — TAT band master (ADR-0044). Effective-dated + OCC, masterdata.manage-gated.
-- The configurable set of turnaround-time bands (4/6/8/12/24/48h) used for target-TAT assignment AND
-- completed-in-band classification. Forward-only, idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS tat_policies (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tat_hours      integer     NOT NULL CHECK (tat_hours > 0),
  label          varchar(40) NOT NULL,
  is_active      boolean     NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  version        integer     NOT NULL DEFAULT 1,
  created_by     uuid,
  updated_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_tat_policies_hours_active
  ON tat_policies (tat_hours) WHERE is_active;

INSERT INTO tat_policies (tat_hours, label)
SELECT v.h, v.h || ' hours'
FROM (VALUES (4),(6),(8),(12),(24),(48)) AS v(h)
WHERE NOT EXISTS (SELECT 1 FROM tat_policies t WHERE t.tat_hours = v.h);

COMMIT;
