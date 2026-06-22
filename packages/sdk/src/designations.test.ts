import { describe, it, expect } from 'vitest';
import { CreateDesignationSchema, UpdateDesignationSchema } from './designations.js';

describe('Designation contract', () => {
  it('accepts a valid designation; department optional', () => {
    expect(CreateDesignationSchema.safeParse({ name: 'Senior Executive' }).success).toBe(true);
    expect(CreateDesignationSchema.safeParse({ name: 'Senior Executive', departmentId: 3 }).success).toBe(
      true,
    );
    const nulled = CreateDesignationSchema.safeParse({ name: 'X', departmentId: null });
    expect(nulled.success && nulled.data.departmentId).toBe(null);
  });
  it('rejects an empty name or a non-positive departmentId', () => {
    expect(CreateDesignationSchema.safeParse({ name: '' }).success).toBe(false);
    expect(CreateDesignationSchema.safeParse({ name: 'X', departmentId: 0 }).success).toBe(false);
  });
  it('uppercases name and description (ADR-0058)', () => {
    const r = CreateDesignationSchema.safeParse({ name: 'Senior Executive', description: 'field role' });
    expect(r.success && r.data.name).toBe('SENIOR EXECUTIVE');
    expect(r.success && r.data.description).toBe('FIELD ROLE');
  });
  it('update requires name', () => {
    expect(UpdateDesignationSchema.safeParse({ name: 'Exec', description: '' }).success).toBe(true);
    expect(UpdateDesignationSchema.safeParse({ description: '' }).success).toBe(false);
  });
});
