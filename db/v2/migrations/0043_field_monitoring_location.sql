-- 0043_field_monitoring_location.sql — Field Monitoring + device location ingest (ADR-0026).
-- Two new GPS tables (NEW names — the existing `locations` is the PINCODE CATALOG, never
-- overloaded) + the Field Monitoring / location-capture permissions.
--   device_locations        — append-only event log of every captured fix (one row per ping)
--   latest_device_location  — one-row-per-agent projection (freshness-guarded upsert), the
--                             roster's "last seen" source
-- Forward-prep: no live producer until crm-mobile-native rebases /location/capture onto
-- /api/v2 (separate repo). The monitoring console runs on case_tasks today; these stay empty.
-- Perms: page.field_monitoring (MANAGER/TEAM_LEADER; SA=grants_all) + location.capture
-- (FIELD_AGENT — the device's ingest perm, mirrors @crm2/access ROLE_PERMISSIONS; the roles
-- parity test asserts byte-identity). Forward-only, idempotent.

BEGIN;

-- Append-only event log. source: ADMIN_PING / TRACKING (live device sources) + TASK (the
-- dormant task-tethered branch). operation_id = the device Idempotency-Key (dedup of the
-- FCM+socket double-delivery). case_id/task_id/requested_by_user_id are FK-LESS (match the
-- actor-column convention so synthetic dev/test ids work; the device sends opaque strings).
CREATE TABLE IF NOT EXISTS device_locations (
  id                   bigserial PRIMARY KEY,
  user_id              uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  latitude             numeric(10, 8) NOT NULL,
  longitude            numeric(11, 8) NOT NULL,
  accuracy             numeric(10, 2),
  recorded_at          timestamptz NOT NULL,
  source               varchar(20) NOT NULL
                         CHECK (source IN ('ADMIN_PING', 'TRACKING', 'TASK')),
  -- The device sends these as OPAQUE strings (caseId = case_number like 'CASE-000007', NOT a uuid;
  -- requested_by = the admin userId). Stored FK-less + text so the locked wire is accepted verbatim.
  case_id              text,
  task_id              text,
  requested_by_user_id text,
  operation_id         varchar(255),
  created_at           timestamptz NOT NULL DEFAULT now()
);

-- Idempotency: a repeated capture (FCM + socket deliver the same ADMIN_PING) collapses to one
-- row. Partial unique so rows without an operation_id are unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS uq_device_locations_operation
  ON device_locations (operation_id) WHERE operation_id IS NOT NULL;
-- "latest fix per user" + recency scans.
CREATE INDEX IF NOT EXISTS idx_device_locations_user_recent
  ON device_locations (user_id, recorded_at DESC);

-- Per-agent projection — the roster's last-known position (single indexed lookup).
CREATE TABLE IF NOT EXISTS latest_device_location (
  user_id     uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  latitude    numeric(10, 8) NOT NULL,
  longitude   numeric(11, 8) NOT NULL,
  accuracy    numeric(10, 2),
  recorded_at timestamptz NOT NULL,
  source      varchar(20) NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

INSERT INTO role_permissions (role_code, permission_code) VALUES
  ('MANAGER',      'page.field_monitoring'),
  ('TEAM_LEADER',  'page.field_monitoring'),
  ('FIELD_AGENT',  'location.capture')
ON CONFLICT (role_code, permission_code) DO NOTHING;

COMMIT;
