-- 0058_commission_rates.sql — per-user commission rate config (ADR-0036, billing slice 5a).
-- The agent-commission amount source for the unified Billing & Commission view: one row =
-- (user, rate_type, client[nullable=universal], amount) over an effective-dated range. v1-parity
-- with field_user_commission_assignments, but ANY user (field/office/KYC) may hold rates — the
-- gate is "any COMPLETED task earns if its assignee has a matching rate" (owner 2026-06-16).
-- Resolution: most-specific-client-wins (client match before universal) + temporal + is_active.
-- This is CONFIG master-data (like `rates`), NOT billed-state — billed-marker + invoice/payout
-- run are the later engine slice. Self-historizing via effective-dating (revise end-dates the old
-- row, inserts a new one) so no separate history table. OCC `version` per ADR-0019. Forward-only,
-- idempotent.

BEGIN;

-- btree_gist powers the no-overlap EXCLUDE on uuid/varchar/int equality + tstzrange overlap
-- (already present for rates_no_overlap; IF NOT EXISTS is a harmless no-op).
CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS commission_rates (
  id             integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id        uuid        NOT NULL REFERENCES users (id),
  rate_type      varchar(60) NOT NULL,
  client_id      integer     REFERENCES clients (id),
  amount         numeric(12,2) NOT NULL CHECK (amount >= 0),
  currency       varchar(3)  NOT NULL DEFAULT 'INR',
  is_active      boolean     NOT NULL DEFAULT true,
  effective_from timestamptz NOT NULL DEFAULT now(),
  effective_to   timestamptz,
  version        integer     NOT NULL DEFAULT 1,
  created_by     uuid, updated_by uuid,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- one ACTIVE rate per (user, rate_type, client[universal=-1]) over a time range
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'commission_rates_no_overlap') THEN
    ALTER TABLE commission_rates ADD CONSTRAINT commission_rates_no_overlap EXCLUDE USING gist (
      user_id WITH =,
      rate_type WITH =,
      (COALESCE(client_id, -1)) WITH =,
      tstzrange(effective_from, COALESCE(effective_to, 'infinity'), '[)') WITH &&
    ) WHERE (is_active);
  END IF;
END $$;

-- resolver path: (user, rate_type, client) most-specific-wins over active rows.
-- `rate_type` is renamed to `field_rate_type` by 0083, and 0079 supersedes this index with a generalized
-- one. Since prod re-runs every migration each deploy, guard this on the pre-rename state — `CREATE INDEX
-- IF NOT EXISTS` still resolves the column list even when the index name already exists, so a bare re-run
-- here errors ("column rate_type does not exist"). Runs on a fresh DB only; no-ops after the rename.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'commission_rates' AND column_name = 'field_rate_type') THEN
    CREATE INDEX IF NOT EXISTS idx_commission_rates_resolve
      ON commission_rates (user_id, rate_type, client_id) WHERE is_active;
  END IF;
END $$;

COMMIT;
