import { describe, it, expect } from 'vitest';
import { CreateCommissionRateSchema, ReviseCommissionRateSchema } from './commissionRates.js';

const userId = '00000000-0000-0000-0000-000000000001';
const base = { userId, rateType: 'LOCAL', amount: 50 };

describe('CommissionRate contract', () => {
  it('accepts a valid universal rate and defaults currency to INR', () => {
    const parsed = CreateCommissionRateSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.currency).toBe('INR');
    expect(parsed.success && parsed.data.clientId).toBeUndefined(); // universal
  });
  it('accepts a client-scoped rate', () => {
    expect(CreateCommissionRateSchema.safeParse({ ...base, clientId: 7 }).success).toBe(true);
  });
  it('rejects a negative amount', () => {
    expect(CreateCommissionRateSchema.safeParse({ ...base, amount: -1 }).success).toBe(false);
  });
  it('rejects a non-uuid userId', () => {
    expect(CreateCommissionRateSchema.safeParse({ ...base, userId: 'nope' }).success).toBe(false);
  });
  it('rejects an empty rateType', () => {
    expect(CreateCommissionRateSchema.safeParse({ ...base, rateType: '' }).success).toBe(false);
  });
  it('revise accepts an amount (+ optional effectiveFrom) only', () => {
    expect(ReviseCommissionRateSchema.safeParse({ amount: 99.99 }).success).toBe(true);
    expect(
      ReviseCommissionRateSchema.safeParse({ amount: 12, effectiveFrom: '2026-01-01T00:00:00.000Z' }).success,
    ).toBe(true);
    expect(ReviseCommissionRateSchema.safeParse({ amount: -1 }).success).toBe(false);
  });
});
