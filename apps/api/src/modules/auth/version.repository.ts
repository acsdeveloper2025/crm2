import { query } from '../../platform/db.js';

export interface MobileReleaseRow {
  latestVersion: string;
  minSupportedVersion: string;
  downloadUrl: string | null;
  releaseNotes: string | null;
  releaseDate: string | null;
  urgent: boolean;
}

/** Mobile force-update gate config (mobile parity). One active row per platform. */
export const versionRepository = {
  async releaseFor(platform: string): Promise<MobileReleaseRow | null> {
    const rows = await query<MobileReleaseRow>(
      `SELECT latest_version, min_supported_version, download_url, release_notes,
              release_date, urgent
       FROM mobile_app_releases WHERE platform = $1 AND is_active = true`,
      [platform],
    );
    return rows[0] ?? null;
  },
};
