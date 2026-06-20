import { TelemetryIngestSchema, type TelemetryIngestResult } from '@crm2/sdk';

/**
 * Mobile telemetry ingest (mobile parity) — a thin accept-and-ack compatibility stub. The device
 * treats this as optional and swallows failures, so we validate-and-count rather than persist; wiring
 * the batch to a telemetry sink is a deliberate later step. Returns how many events were accepted.
 */
export const telemetryService = {
  ingest(rawBody: unknown): TelemetryIngestResult {
    const b = TelemetryIngestSchema.parse(rawBody ?? {});
    return { accepted: b.events?.length ?? 0 };
  },
};
