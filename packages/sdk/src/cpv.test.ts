import { describe, it, expect } from 'vitest';
import { CreateClientProductSchema, CreateCpvUnitSchema } from './cpv.js';

describe('CPV contract — client-product link', () => {
  it('accepts a valid pair', () => {
    expect(CreateClientProductSchema.safeParse({ clientId: 1, productId: 2 }).success).toBe(true);
  });
  it('rejects a non-positive id', () => {
    expect(CreateClientProductSchema.safeParse({ clientId: 0, productId: 2 }).success).toBe(false);
  });
  it('rejects a non-integer id', () => {
    expect(CreateClientProductSchema.safeParse({ clientId: 1.5, productId: 2 }).success).toBe(false);
  });
});

describe('CPV contract — unit enablement', () => {
  it('accepts a valid pair', () => {
    expect(CreateCpvUnitSchema.safeParse({ clientProductId: 1, verificationUnitId: 3 }).success).toBe(true);
  });
  it('rejects a missing id', () => {
    expect(CreateCpvUnitSchema.safeParse({ clientProductId: 1 }).success).toBe(false);
  });
});
