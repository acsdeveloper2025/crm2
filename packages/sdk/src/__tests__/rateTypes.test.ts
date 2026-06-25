import { describe, it, expect } from 'vitest';
import { CreateRateTypeSchema, UpdateRateTypeSchema, RATE_TYPE_CATEGORIES } from '../rateTypes.js';

describe('RateType schemas', () => {
  it('CreateRateTypeSchema uppercases code + name, defaults category FIELD', () => {
    const r = CreateRateTypeSchema.parse({ code: 'local6', name: 'local six' });
    expect(r.code).toBe('LOCAL6');
    expect(r.name).toBe('LOCAL SIX');
    expect(r.category).toBe('FIELD');
  });
  it('CreateRateTypeSchema rejects an unknown category', () => {
    expect(() => CreateRateTypeSchema.parse({ code: 'X', name: 'X', category: 'NOPE' })).toThrow();
  });
  it('UpdateRateTypeSchema has NO code field (code is immutable)', () => {
    expect('code' in UpdateRateTypeSchema.shape).toBe(false);
  });
  it('exposes the two categories', () => {
    expect(RATE_TYPE_CATEGORIES).toEqual(['FIELD', 'OFFICE']);
  });
});
