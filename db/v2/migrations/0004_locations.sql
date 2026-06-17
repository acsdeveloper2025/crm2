-- CRM2 — Build Step (Admin: Location Management).
-- Migration 0004 · forward-only · idempotent.
-- v2 collapses v1's states>cities>pincodes + areas hierarchy into one pincode-centric
-- catalog row (pincode + area + city + state) — the unit assignment and case addresses
-- actually need. A pincode can cover multiple areas → unique (pincode, area).

BEGIN;

CREATE TABLE IF NOT EXISTS locations (
    id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    pincode    varchar(6)   NOT NULL,
    area       varchar(255) NOT NULL,
    city       varchar(100) NOT NULL,
    state      varchar(100) NOT NULL,
    is_active  boolean      NOT NULL DEFAULT true,
    created_by uuid,
    updated_by uuid,
    created_at timestamptz  NOT NULL DEFAULT now(),
    updated_at timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chk_locations_pincode CHECK (pincode ~ '^[1-9][0-9]{5}$'),
    CONSTRAINT uq_locations UNIQUE (pincode, area)
);

CREATE INDEX IF NOT EXISTS idx_locations_pincode ON locations (pincode) WHERE is_active;

COMMIT;
