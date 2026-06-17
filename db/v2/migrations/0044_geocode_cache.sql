-- 0044_geocode_cache.sql — reverse-geocode address cache (ADR-0026 Phase-2: addresses).
-- Coordinate→address is resolved ONCE per 6-dp coordinate then frozen (write-once): an address
-- never changes once stored (ON CONFLICT DO NOTHING at the app layer), so the same fix always
-- shows the same address regardless of later Google data drift — mirrors v1's frozen-address
-- integrity property, at coordinate granularity (the agent's last-known point moves, the address
-- for a given point does not). Populated lazily on first lookup by the Field Monitoring console.
-- Forward-only, idempotent.

BEGIN;

CREATE TABLE IF NOT EXISTS geocode_cache (
  lat         numeric(9, 6) NOT NULL,
  lng         numeric(9, 6) NOT NULL,
  address     text NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (lat, lng)
);

COMMIT;
