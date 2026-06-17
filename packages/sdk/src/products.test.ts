import { describe, it, expect } from 'vitest';
import { CreateProductSchema, UpdateProductSchema } from './products.js';

describe('Product contract', () => {
  it('accepts a valid product', () => {
    expect(CreateProductSchema.safeParse({ code: 'HOME_LOAN', name: 'Home Loan' }).success).toBe(true);
  });
  it('rejects a non-UPPER_SNAKE code', () => {
    expect(CreateProductSchema.safeParse({ code: 'home loan', name: 'Home Loan' }).success).toBe(false);
  });
  it('rejects an empty name', () => {
    expect(CreateProductSchema.safeParse({ code: 'HOME_LOAN', name: '' }).success).toBe(false);
  });
  it('update accepts a name; code is optional (ADR-0020 — correctable while unreferenced)', () => {
    expect(UpdateProductSchema.safeParse({ name: 'Home Loan v2' }).success).toBe(true);
    const withCode = UpdateProductSchema.safeParse({ name: 'Home Loan v2', code: 'HOME' });
    expect(withCode.success && withCode.data.code).toBe('HOME');
    expect(UpdateProductSchema.safeParse({ name: 'X', code: 'lower' }).success).toBe(false);
  });
});
