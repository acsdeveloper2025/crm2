/**
 * @crm2/sdk — mobile force-update gate (mobile parity). POST /api/v2/auth/version-check gates the
 * whole app: the device sends its current version + platform; the server returns whether an update is
 * required/forced. The response is a BARE, FLAT v2-native object (ADR-0054 — no `{success}` envelope);
 * the device reads `forceUpdate`/`latestVersion`/… top-level — keep these field names stable (the gate
 * silently no-ops otherwise).
 */
import { z } from 'zod';

/** Request body. `platform` is normalized to UPPERCASE so a lowercase Platform.OS is accepted. */
export const VersionCheckSchema = z.object({
  currentVersion: z.string().min(1),
  platform: z.preprocess(
    (v) => (typeof v === 'string' ? v.toUpperCase() : v),
    z.enum(['IOS', 'ANDROID', 'WEB']),
  ),
});
export type VersionCheckInput = z.infer<typeof VersionCheckSchema>;

export interface MobileVersionCheckResponse {
  /** currentVersion < minSupportedVersion — hard gate (ForceUpdateScreen). */
  forceUpdate: boolean;
  /** forceUpdate OR currentVersion < latestVersion — show an update prompt. */
  updateRequired: boolean;
  latestVersion: string;
  minSupportedVersion: string;
  // Omitted (not null) when unset — the device schema validates these as string-or-absent.
  downloadUrl?: string;
  releaseNotes?: string;
  releaseDate?: string;
  urgent: boolean;
}
