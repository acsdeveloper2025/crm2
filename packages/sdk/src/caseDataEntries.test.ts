import { describe, it, expect } from 'vitest';
import { SaveDataEntrySchema, SavePickupSchema } from './caseDataEntries.js';

describe('SaveDataEntry contract', () => {
  it('accepts a data map (optionally with an OCC version)', () => {
    expect(SaveDataEntrySchema.safeParse({ data: { sampler_name: 'RAVI', visit_count: 2 } }).success).toBe(
      true,
    );
    expect(SaveDataEntrySchema.safeParse({ data: {}, version: 3 }).success).toBe(true);
  });
  it('rejects a missing/invalid data map and a non-int version', () => {
    expect(SaveDataEntrySchema.safeParse({}).success).toBe(false);
    expect(SaveDataEntrySchema.safeParse({ data: 'nope' }).success).toBe(false);
    expect(SaveDataEntrySchema.safeParse({ data: {}, version: 1.5 }).success).toBe(false);
  });
});

describe('SavePickup contract', () => {
  it('accepts ISO datetimes, text, null-clears, and an OCC version', () => {
    expect(
      SavePickupSchema.safeParse({
        pickupDate: '2024-02-24T11:06:00.000Z',
        reportedDate: '2024-02-24T12:00:00.000Z',
        pickupTrigger: 'NA',
        samplerName: 'OFFICE SAMPLER',
        visitDateTime: null,
        version: 2,
      }).success,
    ).toBe(true);
    expect(SavePickupSchema.safeParse({}).success).toBe(true); // all optional
  });
  it('rejects a non-ISO datetime and an over-long text field', () => {
    expect(SavePickupSchema.safeParse({ pickupDate: '24-02-2024' }).success).toBe(false);
    expect(SavePickupSchema.safeParse({ pickupTrigger: 'x'.repeat(201) }).success).toBe(false);
  });
});
