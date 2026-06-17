import { describe, it, expect } from 'vitest';
import { CreateUserSchema, UpdateUserSchema, USER_ROLES } from './users.js';

const base = { username: 'jane_doe', name: 'Jane Doe', role: 'FIELD_AGENT' as const };

describe('User contract', () => {
  it('accepts a valid user', () => {
    expect(CreateUserSchema.safeParse(base).success).toBe(true);
  });
  it('accepts an optional email and manager uuid', () => {
    const parsed = CreateUserSchema.safeParse({
      ...base,
      email: 'jane@crm2.local',
      reportsTo: '11111111-1111-1111-1111-111111111111',
    });
    expect(parsed.success).toBe(true);
  });
  it('rejects a too-short username', () => {
    expect(CreateUserSchema.safeParse({ ...base, username: 'ab' }).success).toBe(false);
  });
  it('rejects an uppercase username (lowercase identity only)', () => {
    expect(CreateUserSchema.safeParse({ ...base, username: 'Jane' }).success).toBe(false);
  });
  it('rejects a malformed role code (open catalog since ADR-0022 — shape-checked, FK-validated)', () => {
    expect(CreateUserSchema.safeParse({ ...base, role: 'admin' }).success).toBe(false); // lowercase
    expect(CreateUserSchema.safeParse({ ...base, role: 'ZONE_AUDITOR' }).success).toBe(true); // custom ok
  });
  it('rejects a non-uuid manager', () => {
    expect(CreateUserSchema.safeParse({ ...base, reportsTo: 'nope' }).success).toBe(false);
  });
  it('update: username optional — a login rename (ADR-0020); validated when present', () => {
    // name/role-only update is valid (username omitted → unchanged)
    expect(UpdateUserSchema.safeParse({ name: 'New', role: 'MANAGER' }).success).toBe(true);
    // a valid renamed username is accepted and carried
    const renamed = UpdateUserSchema.safeParse({ name: 'New', role: 'MANAGER', username: 'jane_doe2' });
    expect(renamed.success && renamed.data.username).toBe('jane_doe2');
    // too-short / uppercase usernames are still rejected
    expect(UpdateUserSchema.safeParse({ name: 'New', role: 'MANAGER', username: 'x' }).success).toBe(false);
    expect(UpdateUserSchema.safeParse({ name: 'New', role: 'MANAGER', username: 'Jane' }).success).toBe(
      false,
    );
  });
  it('update allows clearing the manager with null', () => {
    expect(UpdateUserSchema.safeParse({ name: 'N', role: 'MANAGER', reportsTo: null }).success).toBe(true);
  });
  it('exposes the six frozen roles', () => {
    expect(USER_ROLES).toHaveLength(6);
  });
});
