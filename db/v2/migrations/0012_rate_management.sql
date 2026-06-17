-- 0012_rate_management.sql — Rate Management rebuild (ADR-0016 / docs/RATE_MANAGEMENT_FREEZE.md).
-- Extends the flat 0003 rates into the full V1-proven engine, VU-keyed:
--   (client, product, VU, location) --SZR--> rate_type --rates--> amount   (KYC VUs skip SZR/rate_type)
-- Adds: rate_types, rate_type_eligibility (with the active-UNIQUE V1 lacked), service_zone_rules
-- (location-keyed), rate_history; extends rates with rate_type_id + effective dates + no-overlap
-- exclusion; ports V1's eligibility-gate trigger. Forward-only, idempotent.

BEGIN;

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ── Tier catalog (no money) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_types (
    id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code        varchar(40)  NOT NULL,
    name        varchar(100) NOT NULL,
    description text,
    is_active   boolean      NOT NULL DEFAULT true,
    sort_order  integer      NOT NULL DEFAULT 0,
    created_by  uuid, updated_by uuid,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT uq_rate_types_code UNIQUE (code)
);

-- ── Eligibility: which rate_types are permitted for a (client, product, VU) ───
CREATE TABLE IF NOT EXISTS rate_type_eligibility (
    id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id            integer NOT NULL REFERENCES clients(id),
    product_id           integer NOT NULL REFERENCES products(id),
    verification_unit_id integer NOT NULL REFERENCES verification_units(id),
    rate_type_id         integer NOT NULL REFERENCES rate_types(id),
    is_active            boolean NOT NULL DEFAULT true,
    created_by  uuid, updated_by uuid,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
-- the integrity fix V1 never had (rate_type_assignments had ZERO uniqueness):
CREATE UNIQUE INDEX IF NOT EXISTS uq_rte_active
    ON rate_type_eligibility (client_id, product_id, verification_unit_id, rate_type_id)
    WHERE is_active;

-- ── Geography → rate_type (location = a v2 pincode+area row) ──────────────────
CREATE TABLE IF NOT EXISTS service_zone_rules (
    id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id            integer NOT NULL REFERENCES clients(id),
    product_id           integer NOT NULL REFERENCES products(id),
    verification_unit_id integer NOT NULL REFERENCES verification_units(id),
    location_id          integer NOT NULL REFERENCES locations(id),
    rate_type_id         integer NOT NULL REFERENCES rate_types(id),
    is_active            boolean NOT NULL DEFAULT true,
    created_by  uuid, updated_by uuid,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_szr_active
    ON service_zone_rules (client_id, product_id, verification_unit_id, location_id)
    WHERE is_active;
CREATE INDEX IF NOT EXISTS idx_szr_lookup
    ON service_zone_rules (client_id, product_id, verification_unit_id, location_id) WHERE is_active;

-- ── Extend rates: rate_type + effective-dated versioning ──────────────────────
ALTER TABLE rates
    ADD COLUMN IF NOT EXISTS rate_type_id   integer REFERENCES rate_types(id),
    ADD COLUMN IF NOT EXISTS effective_from timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS effective_to   timestamptz;

-- backfill the pre-0012 rows' effective_from from created_at (one-time, harmless if re-run)
UPDATE rates SET effective_from = created_at WHERE effective_from > created_at;

-- replace the flat UNIQUE(client,product,VU) with a time-aware no-overlap exclusion
ALTER TABLE rates DROP CONSTRAINT IF EXISTS uq_rates;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rates_no_overlap') THEN
    ALTER TABLE rates ADD CONSTRAINT rates_no_overlap EXCLUDE USING gist (
      client_id WITH =, product_id WITH =, verification_unit_id WITH =,
      (COALESCE(rate_type_id, -1)) WITH =,
      tstzrange(effective_from, COALESCE(effective_to, 'infinity'), '[)') WITH &&
    ) WHERE (is_active);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_rates_resolve
    ON rates (client_id, product_id, verification_unit_id, rate_type_id) WHERE is_active;

-- ── Rate history (written on EVERY change — V1 only logged amount-edits) ──────
CREATE TABLE IF NOT EXISTS rate_history (
    id                 integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    rate_id            integer REFERENCES rates(id),
    action             varchar(20) NOT NULL,
    old_amount         numeric(10,2),
    new_amount         numeric(10,2),
    old_effective_to   timestamptz,
    new_effective_from timestamptz,
    changed_by         uuid,
    changed_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT chk_rate_history_action CHECK (action IN ('CREATE', 'REVISE', 'DEACTIVATE'))
);
CREATE INDEX IF NOT EXISTS idx_rate_history_rate ON rate_history (rate_id, changed_at DESC);

-- ── Eligibility-gate trigger (port of V1 trg_rates_check_rta_allowed) ─────────
-- An active rate that names a rate_type MUST have an active eligibility row for its
-- (client, product, VU, rate_type). KYC VUs (rate_type_id IS NULL) are exempt.
CREATE OR REPLACE FUNCTION rates_check_eligibility() RETURNS trigger AS $$
BEGIN
  IF NEW.is_active AND NEW.rate_type_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM rate_type_eligibility e
       WHERE e.client_id = NEW.client_id AND e.product_id = NEW.product_id
         AND e.verification_unit_id = NEW.verification_unit_id
         AND e.rate_type_id = NEW.rate_type_id AND e.is_active
     ) THEN
    RAISE EXCEPTION 'rate_type % is not eligible for (client %, product %, verification_unit %)',
      NEW.rate_type_id, NEW.client_id, NEW.product_id, NEW.verification_unit_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rates_check_eligibility ON rates;
CREATE TRIGGER trg_rates_check_eligibility
    BEFORE INSERT OR UPDATE ON rates
    FOR EACH ROW EXECUTE FUNCTION rates_check_eligibility();

COMMIT;
