-- 0032_user_portfolio_assignments.sql — backend portfolio scope (Access & Scope milestone, Epic F).
-- A BACKEND_USER is scoped to the clients and/or products assigned to them: their case visibility
-- expands to cases for those clients/products in addition to their own (hierarchy-self) rows.
-- Portfolio is BACKEND_USER-only (enforced at the API). Many assignments per user.
-- Forward-only, idempotent.

CREATE TABLE IF NOT EXISTS user_client_assignments (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  client_id   integer NOT NULL REFERENCES clients (id),
  is_active   boolean NOT NULL DEFAULT true,
  assigned_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_product_assignments (
  id          integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  product_id  integer NOT NULL REFERENCES products (id),
  is_active   boolean NOT NULL DEFAULT true,
  assigned_by uuid,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Idempotency guards (the persistent test DB accumulates migrations across runs).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_client') THEN
    ALTER TABLE user_client_assignments ADD CONSTRAINT uq_user_client UNIQUE (user_id, client_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'uq_user_product') THEN
    ALTER TABLE user_product_assignments ADD CONSTRAINT uq_user_product UNIQUE (user_id, product_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_uca_user ON user_client_assignments (user_id);
CREATE INDEX IF NOT EXISTS idx_upra_user ON user_product_assignments (user_id);
