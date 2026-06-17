import { z } from 'zod';

/**
 * @crm2/sdk — the Client master-data contract (DTO + validation), shared by API,
 * web, and tests. Mirrors crm2/db/v2/migrations/0002 `clients` column-for-column.
 */
export interface Client {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
  /** when the row becomes usable (ADR-0017); usable ⇔ isActive AND effectiveFrom <= now(). */
  effectiveFrom: string;
  /** OCC concurrency token (ADR-0019); sent back on update, bumped on every successful write. */
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

const isoDate = z.string().datetime();

const baseShape = {
  code: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]*$/, 'code must be UPPER_SNAKE')
    .max(64),
  name: z.string().min(1).max(255),
  /** optional; defaults to now() server-side (ADR-0017). */
  effectiveFrom: isoDate.optional(),
};

export const CreateClientSchema = z.object(baseShape);

/**
 * Update: `name`/`effectiveFrom` always editable. `code` is correctable ONLY while the client is
 * unreferenced (ADR-0020, amends ADR-0001) — the server returns 409 CODE_LOCKED once it is in use.
 */
export const UpdateClientSchema = z.object({
  code: baseShape.code.optional(),
  name: z.string().min(1).max(255),
  effectiveFrom: isoDate.optional(),
});

export type CreateClientInput = z.infer<typeof CreateClientSchema>;
export type UpdateClientInput = z.infer<typeof UpdateClientSchema>;
