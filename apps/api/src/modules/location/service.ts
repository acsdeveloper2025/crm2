import { LocationCaptureSchema, type LocationCaptureResponse } from '@crm2/sdk';
import { locationRepository as repo } from './repository.js';
import { AppError } from '../../platform/errors.js';
import { HTTP_STATUS } from '../../platform/http.js';
import { getRealtime } from '../../platform/realtime/index.js';
import type { Actor } from '../../platform/scope/index.js';

/**
 * Device location ingest (ADR-0026) honoring the LOCKED mobile capture contract. Forward-prep:
 * no live producer until crm-mobile-native rebases onto /api/v2. The captured fix belongs to the
 * authenticated device user; `requestedBy` is the admin provenance on an ADMIN_PING.
 */

// Shift window (IST 8 AM–10 PM) — the consent promise: TRACKING ingest is rejected outside it
// (the device drops a 403 OUTSIDE_SHIFT_WINDOW as non-retryable). ADMIN_PING is never gated.
const TRACKING_SHIFT_START_HOUR = 8;
const TRACKING_SHIFT_END_HOUR = 22;
// IST = UTC+05:30. Evaluated against the device fix `timestamp` (deterministic + testable).
const IST_OFFSET_MS = 19_800_000;

// Clock-skew backstop (ADR-0028). A fix can be legitimately OLD (the offline queue replays captures
// hours/days later), so we never reject a PAST timestamp. But a timestamp in the FUTURE means a
// wrong/fast device clock — no fix is captured ahead of the server's own clock — and a fast clock
// could fool the shift-gate or notification ordering. Reject it; the device should stamp with the
// ADR-0028 serverNow() so this never fires. Tolerance covers network latency + rounding.
const MAX_CLIENT_CLOCK_AHEAD_MS = 120_000;

function istHour(iso: string): number {
  return new Date(Date.parse(iso) + IST_OFFSET_MS).getUTCHours();
}

export const locationService = {
  async capture(
    rawBody: unknown,
    actor: Actor,
    idempotencyKey: string | undefined,
  ): Promise<LocationCaptureResponse> {
    const b = LocationCaptureSchema.parse(rawBody);

    // Skew backstop before any timestamp-trusting decision (ADR-0028): future-dated fixes only.
    if (Date.parse(b.timestamp) - Date.now() > MAX_CLIENT_CLOCK_AHEAD_MS)
      throw new AppError(
        HTTP_STATUS.BAD_REQUEST,
        'CLOCK_SKEW_AHEAD',
        'device timestamp is ahead of server time — resync the clock',
      );

    if (b.source === 'TRACKING') {
      const h = istHour(b.timestamp);
      if (h < TRACKING_SHIFT_START_HOUR || h >= TRACKING_SHIFT_END_HOUR)
        throw new AppError(
          HTTP_STATUS.FORBIDDEN,
          'OUTSIDE_SHIFT_WINDOW',
          'tracking is outside the shift window',
        );
    }

    const row = await repo.capture({
      userId: actor.userId,
      latitude: b.latitude,
      longitude: b.longitude,
      accuracy: b.accuracy ?? null,
      recordedAt: b.timestamp,
      source: b.source,
      caseId: b.caseId ?? null,
      taskId: b.taskId ?? null,
      requestedBy: b.requestedBy ?? null,
      operationId: idempotencyKey ?? b.operationId ?? null,
    });

    // Live roster update (ADR-0027): push the fresh fix to the supervisor console room so it
    // repaints without the 30s poll. Best-effort — a no-op when no socket server is running.
    getRealtime().emitToFieldMonitoring('field-monitoring:location-updated', {
      userId: actor.userId,
      latitude: b.latitude,
      longitude: b.longitude,
      accuracy: b.accuracy ?? null,
      recordedAt: row.recordedAt,
      source: b.source,
    });

    return {
      success: true,
      message: 'Location captured',
      data: { id: row.id, timestamp: row.recordedAt, accuracy: row.accuracy },
    };
  },
};
