import { Router } from 'express';
import type { ServerTime } from '@crm2/sdk';

/**
 * Server-authoritative time (ADR-0028). The API host is the single clock authority (NTP-synced;
 * Postgres `now()` is the matching reference). This echoes the server wall-clock so a client can
 * compute a latency-compensated offset (½-RTT) and stamp outgoing time with server-corrected time
 * rather than its own user-settable / drifting clock.
 *
 * Unauthenticated + side-effect-free (like `/health`) — it leaks nothing but the wall clock, and a
 * client too early to hold a token (app boot) can still sync. Express also stamps an accurate `Date`
 * response header, a header-only fallback for the same offset.
 */
export const timeRoutes: Router = Router();

timeRoutes.get('/', (_req, res) => {
  const epochMs = Date.now();
  const body: ServerTime = { serverTime: new Date(epochMs).toISOString(), epochMs };
  res.json(body);
});
