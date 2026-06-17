-- 0063_case_pickups.sql — Zion `NewDataQC` "Pickup Information" — a FIXED per-case office form
-- (same fields for every client, unlike the config-driven DATA_ENTRY layout). One row per case
-- (uq(case_id)); keyed by the office under the same `data_entry.manage` perm + case scope. Derived
-- fields (pickup-for-documents = the case's verification units; bank/NBFC = the client name) and the
-- computed TIME OF VERIFICATION (reported_date − pickup_date, in days) are NOT stored — resolved at
-- read time. OCC `version` per ADR-0019. Forward-only, idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS case_pickups (
  id              integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  case_id         uuid        NOT NULL REFERENCES cases (id),
  pickup_date     timestamptz,
  reported_date   timestamptz,
  pickup_trigger  varchar(200),
  sampler_name    varchar(200),
  visit_date_time timestamptz,
  version         integer     NOT NULL DEFAULT 1,
  created_by uuid, updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_case_pickups_case UNIQUE (case_id)
);

COMMIT;
