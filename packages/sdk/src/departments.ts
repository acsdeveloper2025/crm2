import { z } from 'zod';

/**
 * @crm2/sdk — the Department contract. An organisational unit; a required dropdown on the
 * user form (v1 parity). `name` is the identity (unique). Mirrors migration 0023.
 */
export interface Department {
  id: number;
  name: string;
  description: string;
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

/** Lean shape for the user-form dropdown (USABLE departments only). */
export interface DepartmentOption {
  id: number;
  name: string;
}

const name = z.string().trim().min(1).max(150);
const description = z.string().trim().max(2000);
const isoDate = z.string().datetime();

export const CreateDepartmentSchema = z.object({
  name,
  description: description.default(''),
  effectiveFrom: isoDate.optional(),
});

/** Update: name/description/effectiveFrom editable (name change is FK-safe — refs are by id). */
export const UpdateDepartmentSchema = z.object({
  name,
  description,
  effectiveFrom: isoDate.optional(),
});

export type CreateDepartmentInput = z.input<typeof CreateDepartmentSchema>;
export type UpdateDepartmentInput = z.infer<typeof UpdateDepartmentSchema>;
