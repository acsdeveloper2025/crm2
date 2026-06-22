import { z } from 'zod';
import { toUpper } from './text.js';

/**
 * @crm2/sdk — the Designation contract. A job title; a required dropdown on the user form
 * (v1 parity), optionally linked to a department. `name` is the identity. Mirrors migration 0024.
 */
export interface Designation {
  id: number;
  name: string;
  description: string;
  departmentId: number | null;
  /** joined department name for the list view (null when unlinked). */
  departmentName: string | null;
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

/** Lean shape for the user-form dropdown (USABLE designations only). */
export interface DesignationOption {
  id: number;
  name: string;
}

const name = z.string().trim().min(1).max(150).transform(toUpper);
const description = z.string().trim().max(2000).transform(toUpper);
const departmentId = z.number().int().positive();
const isoDate = z.string().datetime();

export const CreateDesignationSchema = z.object({
  name,
  description: description.default(''),
  departmentId: departmentId.nullable().optional(),
  effectiveFrom: isoDate.optional(),
});

/** Update: all fields editable (name change is FK-safe — refs are by id). */
export const UpdateDesignationSchema = z.object({
  name,
  description,
  departmentId: departmentId.nullable().optional(),
  effectiveFrom: isoDate.optional(),
});

export type CreateDesignationInput = z.input<typeof CreateDesignationSchema>;
export type UpdateDesignationInput = z.infer<typeof UpdateDesignationSchema>;
