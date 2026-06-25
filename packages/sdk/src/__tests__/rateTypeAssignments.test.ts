import { describe, it, expect } from 'vitest';
import { CreateRateTypeAssignmentSchema } from '../rateTypeAssignments.js';

describe('CreateRateTypeAssignmentSchema', () => {
  it('parses a fully-specified assignment', () => {
    const r = CreateRateTypeAssignmentSchema.parse({
      clientId: 1,
      productId: 2,
      verificationUnitId: 3,
      rateTypeId: 4,
    });
    expect(r).toEqual({ clientId: 1, productId: 2, verificationUnitId: 3, rateTypeId: 4 });
  });
  it('accepts a null productId + verificationUnitId (Universal / all)', () => {
    const r = CreateRateTypeAssignmentSchema.parse({
      clientId: 1,
      productId: null,
      verificationUnitId: null,
      rateTypeId: 4,
    });
    expect(r).toMatchObject({ productId: null, verificationUnitId: null });
  });
  it('rejects a missing clientId or rateTypeId', () => {
    expect(() =>
      CreateRateTypeAssignmentSchema.parse({ productId: null, verificationUnitId: null, rateTypeId: 4 }),
    ).toThrow();
    expect(() =>
      CreateRateTypeAssignmentSchema.parse({ clientId: 1, productId: null, verificationUnitId: null }),
    ).toThrow();
  });
  it('rejects a zero/negative or out-of-range id', () => {
    expect(() =>
      CreateRateTypeAssignmentSchema.parse({
        clientId: 0,
        productId: null,
        verificationUnitId: null,
        rateTypeId: 4,
      }),
    ).toThrow();
    expect(() =>
      CreateRateTypeAssignmentSchema.parse({
        clientId: 1,
        productId: null,
        verificationUnitId: null,
        rateTypeId: 2147483648,
      }),
    ).toThrow();
  });
});
