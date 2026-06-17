import { PERMISSIONS, PERMISSION_META } from '@crm2/access';
import type { AccessMatrix } from '@crm2/sdk';
import { roleRepository } from '../roles/repository.js';

/**
 * Access service — the role→permission matrix, DB-backed since ADR-0022 (roles/role_permissions).
 * The permission catalog (codes + labels) stays code-owned; grants_all roles expand to the full
 * catalog. Editing happens via the roles API (role.manage), not here.
 */
export const accessService = {
  async matrix(): Promise<AccessMatrix> {
    const roles = await roleRepository.list();
    const catalog = Object.values(PERMISSIONS);
    return {
      roles: roles.map((r) => r.code),
      permissions: catalog.map((code) => ({ code, ...PERMISSION_META[code] })),
      grants: Object.fromEntries(roles.map((r) => [r.code, r.grantsAll ? [...catalog] : r.permissions])),
    };
  },
};
