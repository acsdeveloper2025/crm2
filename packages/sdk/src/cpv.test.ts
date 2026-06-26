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
  it('accepts a missing unit id (Universal = all units, ADR-0074); still requires the client-product id', () => {
    expect(CreateCpvUnitSchema.safeParse({ clientProductId: 1 }).success).toBe(true); // Universal CPV
    expect(CreateCpvUnitSchema.safeParse({ verificationUnitId: 3 }).success).toBe(false); // no clientProductId
  });
});
