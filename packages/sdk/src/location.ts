import { z } from 'zod';

/**
 * @crm2/sdk — device location ingest (ADR-0026). The LOCKED capture contract the unmodified
 * field app POSTs to `/location/capture`. Forward-prep: no live producer until
 * crm-mobile-native rebases onto /api/v2. Two live device sources (ADMIN_PING, TRACKING)
 * + the dormant TASK branch. Mobile (ADR-0012) is unaffected — this matches its wire shape.
 */
// GPS/NETWORK/PASSIVE are the device's task-tethered capture sources (RN LocationService sends
// `source:'GPS'` on every verification capture); only TRACKING is shift-gated, so these pass through
// as ordinary captures (clock-skew checked, not shift-gated). Mobile compat — additive (ADR-0011).
export const LOCATION_SOURCES = ['ADMIN_PING', 'TRACKING', 'TASK', 'GPS', 'NETWORK', 'PASSIVE'] as const;
export type LocationSource = (typeof LOCATION_SOURCES)[number];

const LAT = z.number().gte(-90).lte(90);
const LNG = z.number().gte(-180).lte(180);

/**
 * The capture body. `accuracy` optional (device usually sends it). `timestamp` is the
 * device-side ISO fix time. `requestedBy`/`caseId`/`taskId` are opaque pass-throughs
 * (FK-less storage). Extra device fields (the type carries a superset) are ignored.
 */
export const LocationCaptureSchema = z.object({
  latitude: LAT,
  longitude: LNG,
  accuracy: z.number().nonnegative().optional(),
  timestamp: z.string().datetime({ offset: true }),
  source: z.enum(LOCATION_SOURCES),
  requestedBy: z.string().optional(),
  caseId: z.string().optional(),
  taskId: z.string().optional(),
  /** idempotency fallback when the `Idempotency-Key` header is absent. */
  operationId: z.string().optional(),
});
export type LocationCaptureRequest = z.infer<typeof LocationCaptureSchema>;

/** Capture response — the envelope the device's offline queue keys off (`success` truthy). */
export interface LocationCaptureResponse {
  success: true;
  message: string;
  data: { id: string; timestamp: string; accuracy: number | null };
}
