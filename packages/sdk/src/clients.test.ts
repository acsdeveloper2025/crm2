import { describe, it, expect } from 'vitest';
import { CreateClientSchema, UpdateClientSchema } from './clients.js';

describe('Client contract', () => {
  it('accepts a valid client', () => {
    expect(CreateClientSchema.safeParse({ code: 'HDFC', name: 'HDFC Bank' }).success).toBe(true);
  });
  it('rejects a non-UPPER_SNAKE code', () => {
    expect(CreateClientSchema.safeParse({ code: 'hdfc', name: 'HDFC' }).success).toBe(false);
  });
  it('rejects an empty name', () => {
    expect(CreateClientSchema.safeParse({ code: 'HDFC', name: '' }).success).toBe(false);
  });
  it('update accepts a name; code is optional (ADR-0020 — correctable while unreferenced)', () => {
    // name-only update is valid (code omitted → unchanged server-side)
    expect(UpdateClientSchema.safeParse({ name: 'HDFC Ltd' }).success).toBe(true);
    // a corrected code is accepted and carried through (the server gates it on dependents)
    const withCode = UpdateClientSchema.safeParse({ name: 'HDFC Ltd', code: 'HDFC' });
    expect(withCode.success && withCode.data.code).toBe('HDFC');
    // an invalid (non-UPPER_SNAKE) code is still rejected
    expect(UpdateClientSchema.safeParse({ name: 'X', code: 'lower' }).success).toBe(false);
  });
});
