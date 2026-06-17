import { describe, it, expect } from 'vitest';
import { CreateRateSchema, UpdateRateSchema } from './rates.js';

const base = { clientId: 1, productId: 2, verificationUnitId: 3, amount: 50 };

describe('Rate contract', () => {
  it('accepts a valid rate and defaults currency to INR', () => {
    const parsed = CreateRateSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.currency).toBe('INR');
  });
  it('rejects a negative amount', () => {
    expect(CreateRateSchema.safeParse({ ...base, amount: -1 }).success).toBe(false);
  });
  it('rejects a non-positive reference id', () => {
    expect(CreateRateSchema.safeParse({ ...base, clientId: 0 }).success).toBe(false);
  });
  it('update accepts an amount only', () => {
    expect(UpdateRateSchema.safeParse({ amount: 99.99 }).success).toBe(true);
    expect(UpdateRateSchema.safeParse({ amount: -1 }).success).toBe(false);
  });
});
