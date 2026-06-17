import { describe, it, expect } from 'vitest';
import { CreateDepartmentSchema, UpdateDepartmentSchema } from './departments.js';

describe('Department contract', () => {
  it('accepts a valid department and defaults description', () => {
    const r = CreateDepartmentSchema.safeParse({ name: 'Operations' });
    expect(r.success && r.data.description).toBe('');
  });
  it('rejects an empty or over-long name', () => {
    expect(CreateDepartmentSchema.safeParse({ name: '' }).success).toBe(false);
    expect(CreateDepartmentSchema.safeParse({ name: 'x'.repeat(151) }).success).toBe(false);
  });
  it('update requires name and accepts description', () => {
    expect(UpdateDepartmentSchema.safeParse({ name: 'Ops', description: 'team' }).success).toBe(true);
    expect(UpdateDepartmentSchema.safeParse({ description: 'team' }).success).toBe(false);
  });
});
