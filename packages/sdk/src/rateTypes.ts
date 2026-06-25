import { z } from 'zod';
import { toUpper } from './text.js';

export const RATE_TYPE_CATEGORIES = ['FIELD', 'OFFICE'] as const;
export type RateTypeCategory = (typeof RATE_TYPE_CATEGORIES)[number];

export interface RateType {
  id: number;
  code: string;
  name: string;
  description: string | null;
  category: RateTypeCategory;
  sortOrder: number;
  isActive: boolean;
  /** when the row becomes usable (ADR-0017); usable ⇔ isActive AND effectiveFrom <= now(). */
  effectiveFrom: string;
  /** OCC token (ADR-0019); sent back on update, bumped on every successful write. */
  version: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Lean shape for a USABLE-only dropdown (active AND in effect). */
export interface RateTypeOption {
  id: number;
  code: string;
  category: RateTypeCategory;
}

const code = z.string().trim().min(1).max(40).transform(toUpper);
const name = z.string().trim().min(1).max(100).transform(toUpper);
const description = z.string().trim().max(2000).transform(toUpper);
const category = z.enum(RATE_TYPE_CATEGORIES);
const sortOrder = z.number().int().min(0);
const isoDate = z.string().datetime();

export const CreateRateTypeSchema = z.object({
  code,
  name,
  description: description.nullable().optional(),
  category: category.default('FIELD'),
  sortOrder: sortOrder.optional(),
  effectiveFrom: isoDate.optional(),
});

/** Update: `code` is IMMUTABLE (it is the FK key in Phase C) — intentionally absent here. */
export const UpdateRateTypeSchema = z.object({
  name,
  description: description.nullable().optional(),
  category,
  sortOrder: sortOrder.optional(),
  effectiveFrom: isoDate.optional(),
});

export type CreateRateTypeInput = z.input<typeof CreateRateTypeSchema>;
export type UpdateRateTypeInput = z.infer<typeof UpdateRateTypeSchema>;
