/**
 * @crm2/sdk — mobile telemetry ingest (mobile parity). The field app posts optional client telemetry
 * batches; the device swallows failures, so this is a best-effort accept-and-ack endpoint (a thin
 * compatibility stub — it returns how many events were accepted; wiring to a sink is a later step).
 */
import { z } from 'zod';

/** POST /api/v2/telemetry/mobile/ingest — a batch of opaque client telemetry events (best-effort). */
export const TelemetryIngestSchema = z.object({
  events: z.array(z.unknown()).optional(),
});
export type TelemetryIngestInput = z.infer<typeof TelemetryIngestSchema>;

/** Bare v2-native ack (ADR-0054, no `{success}` envelope) — how many events were accepted. */
export interface TelemetryIngestResult {
  accepted: number;
}
