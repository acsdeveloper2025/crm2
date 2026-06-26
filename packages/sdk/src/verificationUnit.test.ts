import { describe, it, expect } from 'vitest';
import { CreateVerificationUnitSchema } from './verificationUnit.js';

const field = (over: Record<string, unknown> = {}) => ({
  code: 'RESIDENCE',
  name: 'Residence',
  category: 'FIELD',
  workerRole: 'FIELD_AGENT',
  assignmentMethod: 'TERRITORY_AUTO',
  requiredFormCode: 'RESIDENCE_FORM',
  requiredPhotos: 5,
  requiredGps: true,
  requiredAttachments: [],
  billingProfile: 'AGENT_COMMISSION',
  commissionProfile: 'FIELD_RATE',
  reportTemplateType: 'FIELD_NARRATIVE',
  reverificationRule: 'REVISIT_PARENT_RATE',
  ...over,
});
const kyc = (over: Record<string, unknown> = {}) => ({
  code: 'PAN_CARD',
  name: 'PAN Verification',
  category: 'IDENTITY',
  workerRole: 'KYC_VERIFIER',
  assignmentMethod: 'DESK_POOL',
  requiredFormCode: null,
  requiredPhotos: 0,
  requiredGps: false,
  requiredAttachments: [{ type: 'DOCUMENT', min: 1 }],
  billingProfile: 'CLIENT_INVOICE',
  commissionProfile: 'NONE',
  reportTemplateType: 'KYC_DOCUMENT',
  reverificationRule: 'RECHECK_FRESH_RATE',
  ...over,
});

describe('VerificationUnit contract — FIELD_VISIT invariants', () => {
  it('accepts a valid field unit', () => {
    expect(CreateVerificationUnitSchema.safeParse(field()).success).toBe(true);
  });
  it('rejects <5 photos', () => {
    expect(CreateVerificationUnitSchema.safeParse(field({ requiredPhotos: 3 })).success).toBe(false);
  });
  it('rejects gps=false', () => {
    expect(CreateVerificationUnitSchema.safeParse(field({ requiredGps: false })).success).toBe(false);
  });
  it('rejects missing form code', () => {
    expect(CreateVerificationUnitSchema.safeParse(field({ requiredFormCode: null })).success).toBe(false);
  });
  it('rejects a KYC worker role carrying the field profile', () => {
    // worker_role is the discriminator now (ADR-0070): KYC_VERIFIER + a field profile (5 photos, GPS,
    // AGENT_COMMISSION…) violates the KYC invariants → rejected.
    expect(CreateVerificationUnitSchema.safeParse(field({ workerRole: 'KYC_VERIFIER' })).success).toBe(false);
  });
  it('rejects invoice billing on a field unit', () => {
    expect(CreateVerificationUnitSchema.safeParse(field({ billingProfile: 'CLIENT_INVOICE' })).success).toBe(
      false,
    );
  });
});

describe('VerificationUnit contract — KYC_DOCUMENT invariants', () => {
  it('accepts a valid KYC unit', () => {
    expect(CreateVerificationUnitSchema.safeParse(kyc()).success).toBe(true);
  });
  it('rejects photos>0', () => {
    expect(CreateVerificationUnitSchema.safeParse(kyc({ requiredPhotos: 5 })).success).toBe(false);
  });
  it('rejects empty required attachments', () => {
    expect(CreateVerificationUnitSchema.safeParse(kyc({ requiredAttachments: [] })).success).toBe(false);
  });
  it('rejects commission on a KYC unit', () => {
    expect(CreateVerificationUnitSchema.safeParse(kyc({ commissionProfile: 'FIELD_RATE' })).success).toBe(
      false,
    );
  });
});

describe('VerificationUnit contract — code + result set', () => {
  it('rejects non-UPPER_SNAKE code', () => {
    expect(CreateVerificationUnitSchema.safeParse(field({ code: 'residence' })).success).toBe(false);
  });
  it('rejects empty result set', () => {
    expect(CreateVerificationUnitSchema.safeParse(field({ resultSet: [] })).success).toBe(false);
  });
  it('defaults result set to P/N/R/F', () => {
    const p = CreateVerificationUnitSchema.parse(field());
    expect(p.resultSet).toEqual(['Positive', 'Negative', 'Refer', 'Fraud']);
  });
});

describe('VerificationUnit contract — uppercase transform (ADR-0058)', () => {
  it('uppercases name / category / description display text', () => {
    const p = CreateVerificationUnitSchema.parse(
      field({ name: 'Residence', category: 'Field', description: 'home visit' }),
    );
    expect(p.name).toBe('RESIDENCE');
    expect(p.category).toBe('FIELD');
    expect(p.description).toBe('HOME VISIT');
  });
  it('preserves the UPPER_SNAKE code and requiredFormCode (not transformed)', () => {
    const p = CreateVerificationUnitSchema.parse(
      field({ code: 'RESIDENCE', requiredFormCode: 'RESIDENCE_FORM' }),
    );
    expect(p.code).toBe('RESIDENCE');
    expect(p.requiredFormCode).toBe('RESIDENCE_FORM');
  });
  it('leaves a null/omitted description as-is', () => {
    const p = CreateVerificationUnitSchema.parse(field({ description: null }));
    expect(p.description).toBeNull();
  });
});
