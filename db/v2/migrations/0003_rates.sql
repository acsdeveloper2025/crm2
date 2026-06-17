-- CRM2 — Build Step (Admin: Rate Management).
-- Migration 0003 · forward-only · idempotent.
-- A rate is the price for a verification unit under a client+product. It is the
-- billing authority (v1 lesson: the rate lookup was the de-facto source of price).
-- Keyed by (client, product, verification_unit) like v1 rates, but on the unit id.

BEGIN;

CREATE TABLE IF NOT EXISTS rates (
    id                   integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id            integer       NOT NULL REFERENCES clients(id),
    product_id           integer       NOT NULL REFERENCES products(id),
    verification_unit_id integer       NOT NULL REFERENCES verification_units(id),
    amount               numeric(10,2) NOT NULL CHECK (amount >= 0),
    currency             varchar(3)    NOT NULL DEFAULT 'INR',
    is_active            boolean       NOT NULL DEFAULT true,
    created_by           uuid,
    updated_by           uuid,
    created_at           timestamptz   NOT NULL DEFAULT now(),
    updated_at           timestamptz   NOT NULL DEFAULT now(),
    CONSTRAINT uq_rates UNIQUE (client_id, product_id, verification_unit_id)
);

CREATE INDEX IF NOT EXISTS idx_rates_client_product
    ON rates (client_id, product_id) WHERE is_active;

COMMIT;
