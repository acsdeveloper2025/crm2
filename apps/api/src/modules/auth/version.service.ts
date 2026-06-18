import { VersionCheckSchema, type MobileVersionCheckResponse } from '@crm2/sdk';
import { versionRepository as repo } from './version.repository.js';

/**
 * Numeric compare of dotted versions ("1.0.56" vs "1.0.7"). Each part is compared as an integer
 * (so 1.0.56 > 1.0.7); missing/short parts count as 0. Returns -1 / 0 / 1.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Mobile force-update gate (mobile parity). Compares the device version against the per-platform
 * policy. No policy row → never gate (safe default). Public/pre-auth so a too-old app that can't
 * authenticate still learns it must update.
 */
export const versionService = {
  async checkVersion(rawBody: unknown): Promise<MobileVersionCheckResponse> {
    const b = VersionCheckSchema.parse(rawBody);
    const release = await repo.releaseFor(b.platform);
    if (!release) {
      return {
        success: true,
        forceUpdate: false,
        updateRequired: false,
        latestVersion: b.currentVersion,
        minSupportedVersion: b.currentVersion,
        downloadUrl: null,
        releaseNotes: null,
        releaseDate: null,
        urgent: false,
      };
    }
    const belowMin = compareVersions(b.currentVersion, release.minSupportedVersion) < 0;
    const belowLatest = compareVersions(b.currentVersion, release.latestVersion) < 0;
    return {
      success: true,
      forceUpdate: belowMin,
      updateRequired: belowMin || belowLatest,
      latestVersion: release.latestVersion,
      minSupportedVersion: release.minSupportedVersion,
      downloadUrl: release.downloadUrl,
      releaseNotes: release.releaseNotes,
      releaseDate: release.releaseDate,
      urgent: release.urgent,
    };
  },
};
