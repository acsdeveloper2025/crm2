-- CRM2 — Build Step (Master Data foundation): Clients · Products · Client↔Product
-- Migration 0002 · forward-only · idempotent. Wires the CPV FK created in 0001.

BEGIN;

CREATE TABLE IF NOT EXISTS clients (
    id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code       varchar(64)  NOT NULL UNIQUE,
    name       varchar(255) NOT NULL,
    is_active  boolean      NOT NULL DEFAULT true,
    created_by uuid, updated_by uuid,
    created_at timestamptz  NOT NULL DEFAULT now(),
    updated_at timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
    id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    code       varchar(64)  NOT NULL UNIQUE,
    name       varchar(255) NOT NULL,
    is_active  boolean      NOT NULL DEFAULT true,
    created_by uuid, updated_by uuid,
    created_at timestamptz  NOT NULL DEFAULT now(),
    updated_at timestamptz  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS client_products (
    id         integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    client_id  integer NOT NULL REFERENCES clients(id),
    product_id integer NOT NULL REFERENCES products(id),
    is_active  boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT uq_client_products UNIQUE (client_id, product_id)
);

-- Wire the CPV enablement FK (created without a REFERENCES in 0001).
ALTER TABLE client_product_verification_units
    DROP CONSTRAINT IF EXISTS fk_cpvu_client_product;
ALTER TABLE client_product_verification_units
    ADD CONSTRAINT fk_cpvu_client_product
    FOREIGN KEY (client_product_id) REFERENCES client_products(id);

COMMIT;
