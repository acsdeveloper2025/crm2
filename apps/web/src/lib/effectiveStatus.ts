/**
 * Effective-From status (ADR-0017). A master-data row is USABLE only when it is both
 * active and in effect; admin lists show the three derived states.
 *   ACTIVE    — isActive && effectiveFrom <= now
 *   SCHEDULED — isActive && effectiveFrom >  now (configured, not yet in effect)
 *   INACTIVE  — !isActive
 */
import { serverNow } from './serverClock.js';

export type EffectiveStatus = 'ACTIVE' | 'SCHEDULED' | 'INACTIVE';

export function effectiveStatus(row: { isActive: boolean; effectiveFrom: string }): EffectiveStatus {
  if (!row.isActive) return 'INACTIVE';
  // ADR-0028: compare against server-corrected now, not the (drifting) browser clock, so a row's
  // SCHEDULED→ACTIVE flip agrees with the backend's effective-from evaluation.
  return new Date(row.effectiveFrom).getTime() > serverNow().getTime() ? 'SCHEDULED' : 'ACTIVE';
}
