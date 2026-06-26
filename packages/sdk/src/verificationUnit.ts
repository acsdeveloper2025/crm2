import { z } from 'zod';
import { toUpper } from './text.js';

/**
 * @crm2/sdk — the Verification Unit contract (DTO + validation), shared by API,
 * web, and tests. Mirrors crm2/db/v2/migrations/0001 column-for-column.
 * The cross-field invariants here MIRROR the DB CHECK constraints (defence in depth).
 */
export const WORKER_ROLES = ['FIELD_AGENT', 'KYC_VERIFIER'] as const;
export const ASSIGNMENT_METHODS = ['TERRITORY_AUTO', 'MANUAL', 'DESK_POOL'] as const;
export const BILLING_PROFILES = ['AGENT_COMMISSION', 'CLIENT_INVOICE'] as const;
export const COMMISSION_PROFILES = ['FIELD_RATE', 'NONE'] as const;
export const REPORT_TEMPLATE_TYPES = ['FIELD_NARRATIVE', 'KYC_DOCUMENT'] as const;
export const REVERIFICATION_RULES = ['REVISIT_PARENT_RATE', 'RECHECK_FRESH_RATE'] as const;
export const DEFAULT_RESULT_SET = ['Positive', 'Negative', 'Refer', 'Fraud'] as const;

/**
 * Lightweight VU option for dropdowns (B-22). Carries `workerRole` on top of the generic {@link Option}
 * shape so a selector can split field vs desk units (rate-management: FIELD_AGENT needs geography, a
 * KYC_VERIFIER unit is flat). Structurally assignable to {@link Option} (id/code/name) for callers that
 * ignore `workerRole`.
 */
export interface VerificationUnitOption {
  id: number;
  code: string;
  name: string;
  workerRole: (typeof WORKER_ROLES)[number];
}

export interface VerificationUnit {
  id: number;
  code: string;
  name: string;
  description: string | null;
  version: number;
  category: string;
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
  /** SYSTEM unit (the 9 mobile-hardcoded field-visit types): read-only — the API rejects edit/deactivate
   *  and the admin UI hides those controls, since the field app's form endpoints are keyed to these codes. */
  isSystem: boolean;
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

  // worker_role is the unit's single discriminator (ADR-0070): FIELD_AGENT ⇒ the field-visit profile,
  // KYC_VERIFIER ⇒ the desk-document profile. Same invariants the DB CHECKs enforce, mirrored for errors.
  if (d.workerRole === 'FIELD_AGENT') {
    if (d.requiredPhotos < 5) fail('a FIELD_AGENT unit requires requiredPhotos>=5', 'requiredPhotos');
    if (!d.requiredGps) fail('a FIELD_AGENT unit requires requiredGps=true', 'requiredGps');
    if (!d.requiredFormCode) fail('a FIELD_AGENT unit requires a requiredFormCode', 'requiredFormCode');
    if (d.billingProfile !== 'AGENT_COMMISSION')
      fail('a FIELD_AGENT unit requires billingProfile=AGENT_COMMISSION', 'billingProfile');
    if (d.reportTemplateType !== 'FIELD_NARRATIVE')
      fail('a FIELD_AGENT unit requires reportTemplateType=FIELD_NARRATIVE', 'reportTemplateType');
    if (d.reverificationRule !== 'REVISIT_PARENT_RATE')
      fail('a FIELD_AGENT unit requires reverificationRule=REVISIT_PARENT_RATE', 'reverificationRule');
  }
  if (d.workerRole === 'KYC_VERIFIER') {
    if (d.requiredPhotos !== 0) fail('a KYC_VERIFIER unit requires requiredPhotos=0', 'requiredPhotos');
    if (d.requiredGps) fail('a KYC_VERIFIER unit requires requiredGps=false', 'requiredGps');
    if (!d.requiredAttachments || d.requiredAttachments.length === 0)
      fail('a KYC_VERIFIER unit requires at least one required attachment', 'requiredAttachments');
    if (d.billingProfile !== 'CLIENT_INVOICE')
      fail('a KYC_VERIFIER unit requires billingProfile=CLIENT_INVOICE', 'billingProfile');
    if (d.commissionProfile !== 'NONE')
      fail('a KYC_VERIFIER unit requires commissionProfile=NONE', 'commissionProfile');
    if (d.reportTemplateType !== 'KYC_DOCUMENT')
      fail('a KYC_VERIFIER unit requires reportTemplateType=KYC_DOCUMENT', 'reportTemplateType');
    if (d.reverificationRule !== 'RECHECK_FRESH_RATE')
      fail('a KYC_VERIFIER unit requires reverificationRule=RECHECK_FRESH_RATE', 'reverificationRule');
  }
}

const baseShape = {
  code: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'code must be UPPER_SNAKE'),
  name: z.string().min(1).transform(toUpper),
  description: z.string().transform(toUpper).nullish(),
  category: z.string().min(1).transform(toUpper),
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
