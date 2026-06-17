import { describe, it, expect } from 'vitest';
import { CreateLocationSchema, CreateLocationBatchSchema, UpdateLocationSchema } from './locations.js';

const base = { pincode: '400001', area: 'Fort', city: 'Mumbai', state: 'Maharashtra' };

describe('Location contract', () => {
  it('accepts a valid location', () => {
    expect(CreateLocationSchema.safeParse(base).success).toBe(true);
  });
  it('rejects a malformed pincode', () => {
    expect(CreateLocationSchema.safeParse({ ...base, pincode: '12' }).success).toBe(false);
    expect(CreateLocationSchema.safeParse({ ...base, pincode: '000000' }).success).toBe(false);
    expect(CreateLocationSchema.safeParse({ ...base, pincode: 'ABCDEF' }).success).toBe(false);
  });
  it('rejects an empty area/city/state', () => {
    expect(CreateLocationSchema.safeParse({ ...base, area: '' }).success).toBe(false);
    expect(CreateLocationSchema.safeParse({ ...base, city: '' }).success).toBe(false);
  });
  it('batch schema requires ≥1 area and shares pincode/city/state', () => {
    const ok = CreateLocationBatchSchema.safeParse({
      pincode: '400001',
      city: 'Mumbai',
      state: 'Maharashtra',
      areas: ['Fort', 'Colaba'],
    });
    expect(ok.success && ok.data.country).toBe('India'); // country defaults
    expect(
      CreateLocationBatchSchema.safeParse({ pincode: '400001', city: 'M', state: 'MH', areas: [] }).success,
    ).toBe(false);
    expect(
      CreateLocationBatchSchema.safeParse({ pincode: '12', city: 'M', state: 'MH', areas: ['A'] }).success,
    ).toBe(false);
  });
  it('update accepts area/city/state; pincode optional (ADR-0020 — correctable while unreferenced)', () => {
    expect(UpdateLocationSchema.safeParse({ area: 'Fort', city: 'Mumbai', state: 'MH' }).success).toBe(true);
    const withPin = UpdateLocationSchema.safeParse({ ...base, pincode: '560001' });
    expect(withPin.success && withPin.data.pincode).toBe('560001');
    // a malformed pincode is still rejected
    expect(UpdateLocationSchema.safeParse({ ...base, pincode: '12' }).success).toBe(false);
  });
});
