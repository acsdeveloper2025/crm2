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
  it('uppercases area/city/state/country but not pincode (ADR-0058)', () => {
    const r = CreateLocationSchema.safeParse({ ...base, country: 'india' });
    expect(r.success && r.data.area).toBe('FORT');
    expect(r.success && r.data.city).toBe('MUMBAI');
    expect(r.success && r.data.state).toBe('MAHARASHTRA');
    expect(r.success && r.data.country).toBe('INDIA');
    expect(r.success && r.data.pincode).toBe('400001'); // pincode untouched
  });
  it('batch uppercases each area element (ADR-0058)', () => {
    const r = CreateLocationBatchSchema.safeParse({
      pincode: '400001',
      city: 'Mumbai',
      state: 'Maharashtra',
      areas: ['Fort', 'Colaba'],
    });
    expect(r.success && r.data.areas).toEqual(['FORT', 'COLABA']);
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
    expect(ok.success && ok.data.country).toBe('INDIA'); // country defaults (ADR-0058 uppercases)
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
