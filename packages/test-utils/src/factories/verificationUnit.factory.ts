/**
 * Verification Unit factory — produces a VALID create-input, kind-aware, with overrides.
 * Used by unit + integration tests so every test starts from a passing baseline.
 */
type Kind = 'FIELD_VISIT' | 'KYC_DOCUMENT' | 'DESK_DOCUMENT';

export interface VerificationUnitInput {
  code: string;
  name: string;
  category: string;
  kind: Kind;
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
  kind: 'FIELD_VISIT',
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
  kind: 'KYC_DOCUMENT',
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
  overrides: Partial<VerificationUnitInput> & { kind?: Kind } = {},
): VerificationUnitInput {
  const base = overrides.kind === 'KYC_DOCUMENT' ? KYC_DEFAULTS() : FIELD_DEFAULTS();
  return { ...base, ...overrides };
}
