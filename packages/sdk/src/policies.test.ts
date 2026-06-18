import { describe, it, expect } from 'vitest';
import { CreatePolicySchema, PolicyEffectiveFromSchema, UpdatePolicySchema } from './policies.js';

const base = { code: 'TERMS_OF_USE', name: 'Terms of Use', content: 'Body' };

describe('Policy contract — create', () => {
  it('accepts a valid policy', () => {
    expect(CreatePolicySchema.safeParse(base).success).toBe(true);
  });
  it('accepts a null description', () => {
    expect(CreatePolicySchema.safeParse({ ...base, description: null }).success).toBe(true);
  });
  it('rejects a lowercase code', () => {
    expect(CreatePolicySchema.safeParse({ ...base, code: 'terms' }).success).toBe(false);
  });
  it('rejects a code starting with a digit', () => {
    expect(CreatePolicySchema.safeParse({ ...base, code: '1TERMS' }).success).toBe(false);
  });
  it('rejects an empty name', () => {
    expect(CreatePolicySchema.safeParse({ ...base, name: '' }).success).toBe(false);
  });
  it('rejects empty content', () => {
    expect(CreatePolicySchema.safeParse({ ...base, content: '' }).success).toBe(false);
  });
});

describe('Policy contract — update', () => {
  it('accepts a partial update', () => {
    expect(UpdatePolicySchema.safeParse({ name: 'New name' }).success).toBe(true);
  });
  it('accepts an empty object', () => {
    expect(UpdatePolicySchema.safeParse({}).success).toBe(true);
  });
  it('rejects an invalid code when supplied', () => {
    expect(UpdatePolicySchema.safeParse({ code: 'bad code' }).success).toBe(false);
  });
});

describe('Policy contract — effectiveFrom', () => {
  it('accepts an omitted effectiveFrom', () => {
    expect(PolicyEffectiveFromSchema.safeParse({}).success).toBe(true);
  });
  it('accepts an ISO datetime', () => {
    expect(PolicyEffectiveFromSchema.safeParse({ effectiveFrom: '2026-01-01T00:00:00.000Z' }).success).toBe(
      true,
    );
  });
  it('rejects a non-datetime string', () => {
    expect(PolicyEffectiveFromSchema.safeParse({ effectiveFrom: 'soon' }).success).toBe(false);
  });
});
