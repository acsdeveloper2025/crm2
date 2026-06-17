import { z } from 'zod';

/**
 * @crm2/sdk — the Verification Unit contract (DTO + validation), shared by API,
 * web, and tests. Mirrors crm2/db/v2/migrations/0001 column-for-column.
 * The cross-field invariants here MIRROR the DB CHECK constraints (defence in depth).
 */
export const KINDS = ['FIELD_VISIT', 'KYC_DOCUMENT', 'DESK_DOCUMENT'] as const;
export const WORKER_ROLES = ['FIELD_AGENT', 'KYC_VERIFIER'] as const;
export const ASSIGNMENT_METHODS = ['TERRITORY_AUTO', 'MANUAL', 'DESK_POOL'] as const;
export const BILLING_PROFILES = ['AGENT_COMMISSION', 'CLIENT_INVOICE'] as const;
export const COMMISSION_PROFILES = ['FIELD_RATE', 'NONE'] as const;
export const REPORT_TEMPLATE_TYPES = ['FIELD_NARRATIVE', 'KYC_DOCUMENT'] as const;
export const REVERIFICATION_RULES = ['REVISIT_PARENT_RATE', 'RECHECK_FRESH_RATE'] as const;
export const DEFAULT_RESULT_SET = ['Positive', 'Negative', 'Refer', 'Fraud'] as const;

/**
 * Lightweight VU option for dropdowns (B-22). Carries `kind` on top of the generic {@link Option}
 * shape so a selector can filter by kind (rate-management splits FIELD_VISIT vs KYC_DOCUMENT).
 * Structurally assignable to {@link Option} (id/code/name) for callers that ignore `kind`.
 */
export interface VerificationUnitOption {
  id: number;
  code: string;
  name: string;
  kind: (typeof KINDS)[number];
}

export interface VerificationUnit {
  id: number;
  code: string;
  name: string;
  description: string | null;
  version: number;
  category: string;
  kind: (typeof KINDS)[number];
  workerRole: (typeof WORKER_ROLES)[number];
  assignmentMethod: (typeof ASSIGNMENT_METHODS)[number];
  requiredFormCode: string | null;
  requiredPhotos: number;
  requiredGps: boolean;
  requiredAttachments: unknown[];
  resultSet: string[];
  reviewRequired: boolean;
  billingProfile: (typeof BILLING_PROFILES)[number];
  commissionProfile: (typeof COMMISSION_PROFILES)[number];
  reportTemplateType: (typeof REPORT_TEMPLATE_TYPES)[number];
  reverificationRule: (typeof REVERIFICATION_RULES)[number];
  piiSensitive: boolean;
  isActive: boolean;
  /** when the unit becomes usable (ADR-0017); usable ⇔ isActive AND effectiveFrom <= now(). */
  effectiveFrom: string;
  sortOrder: number;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** The cross-field invariants — single source, reused by create + update + tests. */
function applyInvariants(
  d: {
    kind: string;
    workerRole: string;
    requiredPhotos: number;
    requiredGps: boolean;
    requiredFormCode?: string | null | undefined;
    requiredAttachments?: unknown[] | undefined;
    billingProfile: string;
    commissionProfile: string;
    reportTemplateType: string;
    reverificationRule: string;
  },
  ctx: z.RefinementCtx,
): void {
  const fail = (message: string, path: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [path] });

  if (d.kind === 'FIELD_VISIT') {
    if (d.workerRole !== 'FIELD_AGENT') fail('FIELD_VISIT requires workerRole=FIELD_AGENT', 'workerRole');
    if (d.requiredPhotos < 5) fail('FIELD_VISIT requires requiredPhotos>=5', 'requiredPhotos');
    if (!d.requiredGps) fail('FIELD_VISIT requires requiredGps=true', 'requiredGps');
    if (!d.requiredFormCode) fail('FIELD_VISIT requires a requiredFormCode', 'requiredFormCode');
    if (d.billingProfile !== 'AGENT_COMMISSION')
      fail('FIELD_VISIT requires billingProfile=AGENT_COMMISSION', 'billingProfile');
    if (d.reportTemplateType !== 'FIELD_NARRATIVE')
      fail('FIELD_VISIT requires reportTemplateType=FIELD_NARRATIVE', 'reportTemplateType');
    if (d.reverificationRule !== 'REVISIT_PARENT_RATE')
      fail('FIELD_VISIT requires reverificationRule=REVISIT_PARENT_RATE', 'reverificationRule');
  }
  if (d.kind === 'KYC_DOCUMENT') {
    if (d.workerRole !== 'KYC_VERIFIER') fail('KYC_DOCUMENT requires workerRole=KYC_VERIFIER', 'workerRole');
    if (d.requiredPhotos !== 0) fail('KYC_DOCUMENT requires requiredPhotos=0', 'requiredPhotos');
    if (d.requiredGps) fail('KYC_DOCUMENT requires requiredGps=false', 'requiredGps');
    if (!d.requiredAttachments || d.requiredAttachments.length === 0)
      fail('KYC_DOCUMENT requires at least one required attachment', 'requiredAttachments');
    if (d.billingProfile !== 'CLIENT_INVOICE')
      fail('KYC_DOCUMENT requires billingProfile=CLIENT_INVOICE', 'billingProfile');
    if (d.commissionProfile !== 'NONE')
      fail('KYC_DOCUMENT requires commissionProfile=NONE', 'commissionProfile');
    if (d.reportTemplateType !== 'KYC_DOCUMENT')
      fail('KYC_DOCUMENT requires reportTemplateType=KYC_DOCUMENT', 'reportTemplateType');
    if (d.reverificationRule !== 'RECHECK_FRESH_RATE')
      fail('KYC_DOCUMENT requires reverificationRule=RECHECK_FRESH_RATE', 'reverificationRule');
  }
}

const baseShape = {
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'code must be UPPER_SNAKE'),
  name: z.string().min(1),
  description: z.string().nullish(),
  category: z.string().min(1),
  kind: z.enum(KINDS),
  workerRole: z.enum(WORKER_ROLES),
  assignmentMethod: z.enum(ASSIGNMENT_METHODS),
  requiredFormCode: z.string().nullish(),
  requiredPhotos: z.number().int().min(0).default(0),
  requiredGps: z.boolean().default(false),
  requiredAttachments: z.array(z.unknown()).default([]),
  resultSet: z
    .array(z.string())
    .min(1)
    .default([...DEFAULT_RESULT_SET]),
  reviewRequired: z.boolean().default(true),
  billingProfile: z.enum(BILLING_PROFILES),
  commissionProfile: z.enum(COMMISSION_PROFILES).default('NONE'),
  reportTemplateType: z.enum(REPORT_TEMPLATE_TYPES),
  reverificationRule: z.enum(REVERIFICATION_RULES),
  piiSensitive: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
};

/**
 * Effective-from is parsed SEPARATELY from the write schema (ADR-0017): the unit
 * update path merge-reparses the existing row through the create schema, so a DB
 * timestamp must never flow through zod's strict `datetime()`. Optional ISO string.
 */
export const EffectiveFromSchema = z.object({ effectiveFrom: z.string().datetime().optional() });

export const CreateVerificationUnitSchema = z.object(baseShape).superRefine(applyInvariants);

/** Update: `code` optional — correctable while the unit is unreferenced (ADR-0020); server locks once in use. */
// ADR-0020: `code` is now an optional update field (correctable while unreferenced; server locks once in use).
export const UpdateVerificationUnitSchema = z
  .object({ ...baseShape })
  .partial()
  .extend({
    kind: z.enum(KINDS),
    workerRole: z.enum(WORKER_ROLES),
    requiredPhotos: z.number().int().min(0),
    requiredGps: z.boolean(),
    billingProfile: z.enum(BILLING_PROFILES),
    commissionProfile: z.enum(COMMISSION_PROFILES),
    reportTemplateType: z.enum(REPORT_TEMPLATE_TYPES),
    reverificationRule: z.enum(REVERIFICATION_RULES),
  })
  .superRefine(applyInvariants);

export type CreateVerificationUnitInput = z.input<typeof CreateVerificationUnitSchema>;
export type UpdateVerificationUnitInput = z.infer<typeof UpdateVerificationUnitSchema>;
