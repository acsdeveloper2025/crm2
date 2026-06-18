-- 0071_mobile_app_releases.sql — mobile force-update gate config (mobile parity).
-- POST /api/v2/auth/version-check compares the device's currentVersion against this per-platform
-- policy: currentVersion < min_supported_version → forceUpdate (hard gate); < latest_version →
-- updateRequired (optional prompt). One row per platform; office updates it when a new build ships.
-- Seeded permissive (min = 1.0.0) so the gate stays INERT until ops sets the repointed build as the
-- floor — set min_supported_version to the new /api/v2 build to force old (broken) apps to update.
-- Forward-only, idempotent. Triple-write: file → test:5433 (auto) → dev:54329 (psql -f).

BEGIN;

CREATE TABLE IF NOT EXISTS mobile_app_releases (
  platform              varchar(10) PRIMARY KEY,
  latest_version        text NOT NULL,
  min_supported_version text NOT NULL,
  download_url          text,
  release_notes         text,
  release_date          timestamptz,
  urgent                boolean NOT NULL DEFAULT false,
  is_active             boolean NOT NULL DEFAULT true,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_mobile_app_releases_platform CHECK (platform IN ('IOS', 'ANDROID', 'WEB'))
);

INSERT INTO mobile_app_releases (platform, latest_version, min_supported_version, release_notes) VALUES
  ('ANDROID', '1.0.56', '1.0.0', 'Latest field app.'),
  ('IOS',     '1.0.56', '1.0.0', 'Latest field app.')
ON CONFLICT (platform) DO NOTHING;

COMMIT;
