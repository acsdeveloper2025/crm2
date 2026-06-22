import { z } from 'zod';
import { toUpper } from './text.js';
import { REPORT_TEMPLATE_TYPES } from './verificationUnit.js';

/**
 * @crm2/sdk — the Report Template contract. Authored report bodies the report engine
 * resolves by `templateType` (the SAME set the verification_units registry carries as
 * reportTemplateType — reused from there, single source). Mirrors migration 0008.
 */
export type ReportTemplateType = (typeof REPORT_TEMPLATE_TYPES)[number];

export interface ReportTemplate {
  id: number;
  code: string;
  name: string;
  templateType: ReportTemplateType;
  content: string;
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

const code = z
  .string()
  .trim()
  .min(2)
  .max(50)
  .regex(/^[A-Z0-9][A-Z0-9_]*$/, 'UPPER_SNAKE');
const name = z.string().trim().min(1).max(150).transform(toUpper);
const content = z.string().max(50000);
const templateType = z.enum(REPORT_TEMPLATE_TYPES);
const isoDate = z.string().datetime();

export const CreateReportTemplateSchema = z.object({
  code,
  name,
  templateType,
  content: content.default(''),
  effectiveFrom: isoDate.optional(),
});

/** Update: name/type/content/effectiveFrom editable; `code` correctable while unreferenced (ADR-0020). */
export const UpdateReportTemplateSchema = z.object({
  // ADR-0020: code (the key) correctable only while unreferenced; locked (409 CODE_LOCKED) once in use.
  code: code.optional(),
  name,
  templateType,
  content,
  effectiveFrom: isoDate.optional(),
});

export type CreateReportTemplateInput = z.input<typeof CreateReportTemplateSchema>;
export type UpdateReportTemplateInput = z.infer<typeof UpdateReportTemplateSchema>;
