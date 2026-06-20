import { describe, it, expect } from 'vitest';
import { CreateCommissionRateSchema, ReviseCommissionRateSchema } from './commissionRates.js';

const userId = '00000000-0000-0000-0000-000000000001';
// ADR-0050: every dimension is a required tariff key — a fully-specified row.
const base = {
  userId,
  clientId: 7,
  productId: 3,
  verificationUnitId: 5,
  locationId: 12,
  fieldRateType: 'LOCAL',
  tatBand: 24,
  amount: 50,
};

describe('CommissionRate contract', () => {
  it('accepts a valid fully-specified rate and defaults currency to INR', () => {
    const parsed = CreateCommissionRateSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.currency).toBe('INR');
    expect(parsed.success && parsed.data.clientId).toBe(7);
    expect(parsed.success && parsed.data.locationId).toBe(12);
    expect(parsed.success && parsed.data.productId).toBe(3);
    expect(parsed.success && parsed.data.verificationUnitId).toBe(5);
    expect(parsed.success && parsed.data.tatBand).toBe(24);
  });
  it('rejects a negative amount', () => {
    expect(CreateCommissionRateSchema.safeParse({ ...base, amount: -1 }).success).toBe(false);
  });
  it('rejects a non-uuid userId', () => {
    expect(CreateCommissionRateSchema.safeParse({ ...base, userId: 'nope' }).success).toBe(false);
  });
  it('rejects an empty fieldRateType', () => {
    expect(CreateCommissionRateSchema.safeParse({ ...base, fieldRateType: '' }).success).toBe(false);
  });
  it('rejects a fieldRateType outside LOCAL/OGL/OFFICE (a resolution key, not a free label)', () => {
    expect(CreateCommissionRateSchema.safeParse({ ...base, fieldRateType: 'OUTSTATION' }).success).toBe(
      false,
    );
  });
  it('rejects a payload missing a REQUIRED-specific dimension (user/location/fieldRateType) — ADR-0050', () => {
    for (const dim of ['userId', 'locationId', 'fieldRateType'] as const) {
      const { [dim]: _omit, ...partial } = base;
      expect(CreateCommissionRateSchema.safeParse(partial).success).toBe(false);
    }
  });
  // ADR-0050: an OFFICE commission row is location-less (a flat desk rate) — accepted without locationId;
  // a LOCAL/OGL row still requires a location (the refine).
  it('accepts an OFFICE commission row without locationId, rejects a LOCAL row without locationId', () => {
    const { locationId: _l, ...noLoc } = base;
    expect(CreateCommissionRateSchema.safeParse({ ...noLoc, fieldRateType: 'OFFICE' }).success).toBe(true);
    expect(CreateCommissionRateSchema.safeParse({ ...noLoc, fieldRateType: 'LOCAL' }).success).toBe(false);
  });

  it('accepts omitting any UNIVERSAL-able dimension (client/product/unit/tatBand ⇒ matches any) — ADR-0050', () => {
    for (const dim of ['clientId', 'productId', 'verificationUnitId', 'tatBand'] as const) {
      const { [dim]: _omit, ...partial } = base;
      expect(CreateCommissionRateSchema.safeParse(partial).success).toBe(true);
    }
  });
  it('accepts the overflow tat_band sentinel (-1)', () => {
    expect(CreateCommissionRateSchema.safeParse({ ...base, tatBand: -1 }).success).toBe(true);
  });
  it('rejects a non-positive locationId', () => {
    expect(CreateCommissionRateSchema.safeParse({ ...base, locationId: -3 }).success).toBe(false);
  });
  it('revise accepts an amount (+ optional effectiveFrom) only', () => {
    expect(ReviseCommissionRateSchema.safeParse({ amount: 99.99 }).success).toBe(true);
    expect(
      ReviseCommissionRateSchema.safeParse({ amount: 12, effectiveFrom: '2026-01-01T00:00:00.000Z' }).success,
    ).toBe(true);
    expect(ReviseCommissionRateSchema.safeParse({ amount: -1 }).success).toBe(false);
  });
});
