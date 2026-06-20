import { describe, it, expect } from 'vitest';
import { BulkAssignSchema } from './tasks.js';

const TASK = '00000000-0000-0000-0000-000000000002';
const USER = '00000000-0000-0000-0000-000000000003';

const base = {
  items: [{ id: TASK, version: 1 }],
  assignedTo: USER,
  visitType: 'FIELD' as const,
  fieldRateType: 'LOCAL' as const,
  billCount: 1,
};

describe('Pipeline bulk-assign contract', () => {
  it('accepts a valid request', () => {
    expect(BulkAssignSchema.safeParse(base).success).toBe(true);
  });
  it('requires at least one item and caps at 500', () => {
    expect(BulkAssignSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    const many = Array.from({ length: 501 }, () => ({ id: TASK, version: 1 }));
    expect(BulkAssignSchema.safeParse({ ...base, items: many }).success).toBe(false);
  });
  it('rejects non-uuid ids and negative versions (OCC token mandatory per row)', () => {
    expect(BulkAssignSchema.safeParse({ ...base, items: [{ id: 'not-a-uuid', version: 1 }] }).success).toBe(
      false,
    );
    expect(BulkAssignSchema.safeParse({ ...base, items: [{ id: TASK, version: -1 }] }).success).toBe(false);
    expect(BulkAssignSchema.safeParse({ ...base, items: [{ id: TASK }] }).success).toBe(false);
  });
  it('rejects an invalid visit type / distance band / bill count', () => {
    expect(BulkAssignSchema.safeParse({ ...base, visitType: 'TELEPATHY' }).success).toBe(false);
    expect(BulkAssignSchema.safeParse({ ...base, fieldRateType: 'ORBITAL' }).success).toBe(false);
    expect(BulkAssignSchema.safeParse({ ...base, billCount: 51 }).success).toBe(false);
  });
});
