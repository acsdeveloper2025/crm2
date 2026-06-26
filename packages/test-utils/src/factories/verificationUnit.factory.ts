/**
 * Verification Unit factory — produces a VALID create-input, worker-role-aware, with overrides.
 * Used by unit + integration tests so every test starts from a passing baseline. worker_role is the
 * unit's discriminator (ADR-0070): FIELD_AGENT ⇒ the field-visit profile, KYC_VERIFIER ⇒ the desk profile.
 */
export interface VerificationUnitInput {
  code: string;
  name: string;
  category: string;
  workerRole: 'FIELD_AGENT' | 'KYC_VERIFIER';
  assignmentMethod: 'TERRITORY_AUTO' | 'MANUAL' | 'DESK_POOL';
  requiredFormCode: string | null;
  requiredPhotos: number;
  requiredGps: boolean;
  requiredAttachments: unknown[];
  resultSet: string[];
  reviewRequired: boolean;
  billingProfile: 'AGENT_COMMISSION' | 'CLIENT_INVOICE';
  commissionProfile: 'FIELD_RATE' | 'NONE';
  reportTemplateType: 'FIELD_NARRATIVE' | 'KYC_DOCUMENT';
  reverificationRule: 'REVISIT_PARENT_RATE' | 'RECHECK_FRESH_RATE';
  piiSensitive: boolean;
  sortOrder: number;
}

let seq = 0;

const FIELD_DEFAULTS = (): VerificationUnitInput => ({
  code: `FIELD_UNIT_${++seq}`,
  name: `Field Unit ${seq}`,
  category: 'FIELD',
  workerRole: 'FIELD_AGENT',
  assignmentMethod: 'TERRITORY_AUTO',
  requiredFormCode: `FORM_${seq}`,
  requiredPhotos: 5,
  requiredGps: true,
  requiredAttachments: [],
  resultSet: ['Positive', 'Negative', 'Refer', 'Fraud'],
  reviewRequired: true,
  billingProfile: 'AGENT_COMMISSION',
  commissionProfile: 'FIELD_RATE',
  reportTemplateType: 'FIELD_NARRATIVE',
  reverificationRule: 'REVISIT_PARENT_RATE',
  piiSensitive: false,
  sortOrder: 0,
});

const KYC_DEFAULTS = (): VerificationUnitInput => ({
  code: `KYC_UNIT_${++seq}`,
  name: `KYC Unit ${seq}`,
  category: 'IDENTITY',
  workerRole: 'KYC_VERIFIER',
  assignmentMethod: 'DESK_POOL',
  requiredFormCode: null,
  requiredPhotos: 0,
  requiredGps: false,
  requiredAttachments: [{ type: 'DOCUMENT', min: 1 }],
  resultSet: ['Positive', 'Negative', 'Refer', 'Fraud'],
  reviewRequired: true,
  billingProfile: 'CLIENT_INVOICE',
  commissionProfile: 'NONE',
  reportTemplateType: 'KYC_DOCUMENT',
  reverificationRule: 'RECHECK_FRESH_RATE',
  piiSensitive: true,
  sortOrder: 0,
});

export function verificationUnitFactory(
  overrides: Partial<VerificationUnitInput> = {},
): VerificationUnitInput {
  const base = overrides.workerRole === 'KYC_VERIFIER' ? KYC_DEFAULTS() : FIELD_DEFAULTS();
  return { ...base, ...overrides };
}
