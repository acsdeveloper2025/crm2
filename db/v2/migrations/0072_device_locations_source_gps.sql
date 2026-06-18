-- 0072 — widen device_locations.source CHECK to the full mobile SDK LOCATION_SOURCES set.
--
-- Why: the field app (and packages/sdk/src/location.ts LOCATION_SOURCES) sends source values
-- 'GPS' / 'NETWORK' / 'PASSIVE' on a verification location capture, but 0043 created the column with
-- CHECK (source IN ('ADMIN_PING','TRACKING','TASK')) only — so any GPS/NETWORK/PASSIVE capture raised
-- a 23514 CHECK violation (500) and the device sync queue retried it forever. The request Zod schema
-- already admits the wider set; only the DB domain was stale.
--
-- ADR-0011 additive-only: this is a pure superset — every previously-allowed value still passes,
-- nothing is renamed/removed/narrowed. Idempotent (DROP IF EXISTS + re-add with the same name).
-- latest_device_location.source is varchar(20) WITHOUT a CHECK, so it needs no change.

BEGIN;

ALTER TABLE device_locations DROP CONSTRAINT IF EXISTS device_locations_source_check;
ALTER TABLE device_locations
  ADD CONSTRAINT device_locations_source_check
  CHECK (source IN ('ADMIN_PING', 'TRACKING', 'TASK', 'GPS', 'NETWORK', 'PASSIVE'));

COMMIT;
