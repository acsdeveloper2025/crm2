-- 0094_rate_type_fk_conversion.sql — ADR-0068 Phase C. Make rate_types the FK source of truth:
-- add rate_type_id to rates/commission_rates/case_tasks, backfill from the old string/enum columns,
-- swap the two no-overlap EXCLUDE terms + drop the case_tasks CHECK, and DROP the 3 old columns in place.
-- Resolution PRESERVED (the value source becomes a FK; codes JOIN back for display + commission id-match).
-- Forward-only, idempotent, RE-RUN-SAFE: every step that references an old column is guarded on that
-- column's existence so a post-conversion re-run no-ops. Pairs with the re-run guards added to
-- 0011/0013/0079/0084 (which would otherwise resurrect the dropped columns / wipe the catalog).
-- task_assignment_history.field_rate_type is KEPT (append-only audit varchar, not a resolution input).

BEGIN;

-- 1. Lossless catalog reconciliation: auto-promote every distinct free-text client_rate_type into the
--    catalog so the FK backfill loses nothing. (commission/case_tasks codes are already LOCAL/OGL/OFFICE.)
--    Guarded on the old column so a post-conversion re-run no-ops.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'rates' AND column_name = 'client_rate_type') THEN
    INSERT INTO rate_types (code, name, is_active)
    SELECT DISTINCT UPPER(TRIM(client_rate_type)), UPPER(TRIM(client_rate_type)), true
      FROM rates
     WHERE client_rate_type IS NOT NULL AND TRIM(client_rate_type) <> ''
    ON CONFLICT (code) DO NOTHING;
  END IF;
END $$;

-- 2. Add the FK column (NULLABLE — KYC rates/tasks legitimately have no rate type) + ensure the FK
--    constraint EXPLICITLY. `rates.rate_type_id` can pre-exist from 0012's churn (and 0013 cascade-drops
--    its old FK when it drops the 0012 catalog), so `ADD COLUMN ... REFERENCES` would silently skip the
--    FK — add the constraint by name, idempotently, so it always exists referencing the managed catalog.
ALTER TABLE rates            ADD COLUMN IF NOT EXISTS rate_type_id integer;
ALTER TABLE commission_rates ADD COLUMN IF NOT EXISTS rate_type_id integer;
ALTER TABLE case_tasks       ADD COLUMN IF NOT EXISTS rate_type_id integer;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rates_rate_type_id_fkey') THEN
    ALTER TABLE rates ADD CONSTRAINT rates_rate_type_id_fkey
      FOREIGN KEY (rate_type_id) REFERENCES rate_types (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_rates_rate_type_id_fkey') THEN
    ALTER TABLE commission_rates ADD CONSTRAINT commission_rates_rate_type_id_fkey
      FOREIGN KEY (rate_type_id) REFERENCES rate_types (id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'case_tasks_rate_type_id_fkey') THEN
    ALTER TABLE case_tasks ADD CONSTRAINT case_tasks_rate_type_id_fkey
      FOREIGN KEY (rate_type_id) REFERENCES rate_types (id);
  END IF;
END $$;

-- 3. Backfill by UPPER(old) = code (null/blank old → null id; KYC legitimately null). Guarded per column.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'rates' AND column_name = 'client_rate_type') THEN
    UPDATE rates r SET rate_type_id = rt.id
      FROM rate_types rt
     WHERE rt.code = UPPER(TRIM(r.client_rate_type))
       AND r.rate_type_id IS NULL AND r.client_rate_type IS NOT NULL AND TRIM(r.client_rate_type) <> '';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'commission_rates' AND column_name = 'field_rate_type') THEN
    UPDATE commission_rates c SET rate_type_id = rt.id
      FROM rate_types rt
     WHERE rt.code = UPPER(TRIM(c.field_rate_type))
       AND c.rate_type_id IS NULL AND c.field_rate_type IS NOT NULL AND TRIM(c.field_rate_type) <> '';
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'case_tasks' AND column_name = 'field_rate_type') THEN
    UPDATE case_tasks ct SET rate_type_id = rt.id
      FROM rate_types rt
     WHERE rt.code = UPPER(TRIM(ct.field_rate_type))
       AND ct.rate_type_id IS NULL AND ct.field_rate_type IS NOT NULL AND TRIM(ct.field_rate_type) <> '';
  END IF;
END $$;

-- 4. Swap the no-overlap EXCLUDE terms from the string column to rate_type_id (drop + guarded re-add).
--    MUST precede the column DROP (the EXCLUDE depends on the column). btree_gist enabled by 0012.
ALTER TABLE rates DROP CONSTRAINT IF EXISTS rates_no_overlap;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rates_no_overlap') THEN
    ALTER TABLE rates ADD CONSTRAINT rates_no_overlap EXCLUDE USING gist (
      client_id WITH =, product_id WITH =, verification_unit_id WITH =,
      (COALESCE(location_id, -1)) WITH =,
      (COALESCE(rate_type_id, -1)) WITH =,
      tstzrange(effective_from, COALESCE(effective_to, 'infinity'), '[)') WITH &&
    ) WHERE (is_active);
  END IF;
END $$;

ALTER TABLE commission_rates DROP CONSTRAINT IF EXISTS commission_rates_no_overlap;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_rates_no_overlap') THEN
    ALTER TABLE commission_rates ADD CONSTRAINT commission_rates_no_overlap EXCLUDE USING gist (
      user_id WITH =,
      (COALESCE(location_id, -1)) WITH =,
      (COALESCE(client_id, -1)) WITH =,
      (COALESCE(product_id, -1)) WITH =,
      (COALESCE(verification_unit_id, -1)) WITH =,
      (COALESCE(tat_band, 0)) WITH =,
      (COALESCE(rate_type_id, -1)) WITH =,
      tstzrange(effective_from, COALESCE(effective_to, 'infinity'), '[)') WITH &&
    ) WHERE (is_active);
  END IF;
END $$;

-- 5. Drop the case_tasks enum CHECK (the FK supersedes it).
ALTER TABLE case_tasks DROP CONSTRAINT IF EXISTS chk_case_task_field_rate_type;

-- 6. Drop the 3 old string columns IN PLACE. task_assignment_history.field_rate_type is KEPT (audit).
ALTER TABLE rates            DROP COLUMN IF EXISTS client_rate_type;
ALTER TABLE commission_rates DROP COLUMN IF EXISTS field_rate_type;
ALTER TABLE case_tasks       DROP COLUMN IF EXISTS field_rate_type;

COMMIT;
