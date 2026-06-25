import { describe, it, expect } from 'vitest';
import { BulkSetRateTypeAssignmentsSchema } from '../rateTypeAssignments.js';

describe('BulkSetRateTypeAssignmentsSchema', () => {
  it('parses a valid combo + rate-type id list', () => {
    const r = BulkSetRateTypeAssignmentsSchema.parse({
      clientId: 1,
      productId: 2,
      verificationUnitId: 3,
      rateTypeIds: [4, 5],
    });
    expect(r.rateTypeIds).toEqual([4, 5]);
  });
  it('accepts an empty rateTypeIds array (clearing the combo)', () => {
    expect(
      BulkSetRateTypeAssignmentsSchema.parse({
        clientId: 1,
        productId: 2,
        verificationUnitId: 3,
        rateTypeIds: [],
      }).rateTypeIds,
    ).toEqual([]);
  });
  it('rejects a zero/negative id', () => {
    expect(() =>
      BulkSetRateTypeAssignmentsSchema.parse({
        clientId: 1,
        productId: 2,
        verificationUnitId: 3,
        rateTypeIds: [0],
      }),
    ).toThrow();
    expect(() =>
      BulkSetRateTypeAssignmentsSchema.parse({
        clientId: -1,
        productId: 2,
        verificationUnitId: 3,
        rateTypeIds: [4],
      }),
    ).toThrow();
  });
  it('rejects a missing combo key', () => {
    expect(() =>
      BulkSetRateTypeAssignmentsSchema.parse({ clientId: 1, productId: 2, rateTypeIds: [4] }),
    ).toThrow();
  });
  it('caps the array length and the id range (parity with sibling array schemas)', () => {
    expect(() =>
      BulkSetRateTypeAssignmentsSchema.parse({
        clientId: 1,
        productId: 2,
        verificationUnitId: 3,
        rateTypeIds: Array.from({ length: 501 }, (_, i) => i + 1),
      }),
    ).toThrow();
    expect(() =>
      BulkSetRateTypeAssignmentsSchema.parse({
        clientId: 1,
        productId: 2,
        verificationUnitId: 3,
        rateTypeIds: [2147483648],
      }),
    ).toThrow();
  });
});
