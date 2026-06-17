import { computeClockOffsetMs, serverNowMs, type ServerTime } from '@crm2/sdk';
import { api } from './sdk.js';

/**
 * Server-authoritative clock (ADR-0028). On boot the web app reads `GET /api/v2/time`, computes a
 * latency-compensated offset (½-RTT), and exposes `serverNow()` so any time-sensitive *client-side*
 * decision (e.g. effective-from ACTIVE/SCHEDULED, relative-time display, sort tiebreaks) agrees with
 * the backend instead of trusting a drifting browser clock. Server-stamped values (created_at, etc.)
 * are already authoritative — this only corrects the times the browser itself originates.
 */
let offsetMs = 0;

/** Sync the offset from the server. Safe to call repeatedly (e.g. boot + on window focus). */
export async function syncServerClock(): Promise<void> {
  const t0 = Date.now();
  const r = await api<ServerTime>('GET', '/api/v2/time');
  const t1 = Date.now();
  offsetMs = computeClockOffsetMs(t0, r.epochMs, t1);
}

/** Server-corrected "now". Falls back to the local clock (offset 0) until the first sync resolves. */
export function serverNow(): Date {
  return new Date(serverNowMs(offsetMs));
}

/** The current offset in ms (local→server). Exposed for diagnostics / display. */
export function serverClockOffsetMs(): number {
  return offsetMs;
}
