import { describe, it, expect } from 'vitest';
import { hasPermission } from './permissions.js';

/**
 * Central permission check (mirrors the server's grant model): SUPER_ADMIN has grantsAll;
 * everyone else carries an explicit permissions list. UX gating must use the SAME perm the
 * server write endpoint enforces (the server stays authoritative; this is defense-in-depth).
 */
describe('hasPermission', () => {
  it('grantsAll holders pass any permission', () => {
    expect(hasPermission({ grantsAll: true }, 'anything.at.all')).toBe(true);
  });

  it('matches an explicit permission in the list', () => {
    expect(hasPermission({ permissions: ['case.view', 'case.create'] }, 'case.create')).toBe(true);
  });

  it('denies a permission not in the list', () => {
    expect(hasPermission({ permissions: ['case.view'] }, 'case.create')).toBe(false);
  });

  it('denies when there is no user', () => {
    expect(hasPermission(null, 'case.view')).toBe(false);
    expect(hasPermission(undefined, 'case.view')).toBe(false);
  });

  it('denies (does not throw) when permissions is absent', () => {
    expect(hasPermission({}, 'case.view')).toBe(false);
  });
});
