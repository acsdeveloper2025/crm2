import { z } from 'zod';
import { AppError } from './errors.js';

/**
 * Optimistic Concurrency Control helper (ADR-0019). Every guarded update REQUIRES the expected
 * `version` the user started from, carried in the request body. A missing / non-integer version is
 * a client contract error → 400 VERSION_REQUIRED (distinct from a field-validation 400). Pulled out
 * of the per-entity zod schema on purpose so its error code stays stable across modules.
 */
const VersionEnvelope = z.object({ version: z.number().int().nonnegative() });

export function requireVersion(input: unknown): number {
  const parsed = VersionEnvelope.safeParse(input);
  if (!parsed.success) throw AppError.versionRequired();
  return parsed.data.version;
}
