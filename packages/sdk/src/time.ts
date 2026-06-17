import { z } from 'zod';

/**
 * @crm2/sdk — server-authoritative time (ADR-0028). The backend host is the single clock authority
 * (NTP-synced; Postgres `now()` is the reference). Clients GET `/api/v2/time`, compute a
 * latency-compensated offset, and stamp outgoing time with server-corrected time instead of trusting
 * the (user-settable / drifting) device clock for gated or ordered decisions — the IST shift-gate,
 * sync watermarks, idempotency correlation, and notification/location ordering.
 */
export const ServerTimeSchema = z.object({
  /** ISO-8601 server wall-clock at response generation (offset-bearing). */
  serverTime: z.string().datetime({ offset: true }),
  /** Same instant as epoch milliseconds — the value clients diff against their local clock. */
  epochMs: z.number().int().nonnegative(),
});
export type ServerTime = z.infer<typeof ServerTimeSchema>;

/** Tolerance (½ RTT) divisor — symmetric-latency assumption of the NTP-style estimate. */
const RTT_HALVES = 2;

/**
 * NTP-style ½-RTT clock offset, in milliseconds to ADD to the local clock to approximate server time.
 * `t0Ms` = local clock when the request was sent, `serverEpochMs` = the server's `epochMs` from the
 * response, `t1Ms` = local clock when the response was received. Assumes symmetric request/response
 * latency: the server reading is taken to correspond to the midpoint `t0 + RTT/2`, so
 * `offset = serverEpoch + RTT/2 − t1`.
 */
export function computeClockOffsetMs(t0Ms: number, serverEpochMs: number, t1Ms: number): number {
  const rtt = t1Ms - t0Ms;
  return Math.round(serverEpochMs + rtt / RTT_HALVES - t1Ms);
}

/**
 * Server-corrected "now" in epoch milliseconds, given a previously computed `offsetMs`. Pass `nowMs`
 * to derive it from a captured instant; defaults to the live local clock.
 */
export function serverNowMs(offsetMs: number, nowMs: number = Date.now()): number {
  return nowMs + offsetMs;
}
