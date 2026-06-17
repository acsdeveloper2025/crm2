import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ROLES, ROLE_PERMISSIONS, PERMISSIONS } from '@crm2/access';
import { createTestDb } from '@crm2/test-utils';

/**
 * Access Control 2.0 slice 1 (ADR-0022) — day-0 parity gate.
 * The roles/role_permissions seed must reproduce the code-defined model byte-identically:
 * the slice-2 authorize() cutover may only land while this stays green.
 */
const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;

const ALL_PERMISSIONS = [...Object.values(PERMISSIONS)].sort();

describe.skipIf(!RUN)('roles seed parity (ADR-0022 slice 1)', () => {
  beforeAll(async () => {
    await db!.migrate();
  });
  afterAll(async () => {
    await db!.end();
  });

  it('seeds exactly the 6 system roles with the locked hierarchy modes + reporting lines', async () => {
    const { rows } = await db!.pool.query<{
      code: string;
      grants_all: boolean;
      hierarchy_mode: string;
      reports_to_role: string | null;
      is_system: boolean;
    }>(`SELECT code, grants_all, hierarchy_mode, reports_to_role, is_system FROM roles ORDER BY code`);
    const byCode = Object.fromEntries(rows.map((r) => [r.code, r]));
    expect(rows.map((r) => r.code).sort()).toEqual([...ROLES].sort());
    expect(rows.every((r) => r.is_system)).toBe(true);
    expect(byCode['SUPER_ADMIN']).toMatchObject({
      grants_all: true,
      hierarchy_mode: 'ALL',
      reports_to_role: null,
    });
    expect(byCode['MANAGER']).toMatchObject({
      grants_all: false,
      hierarchy_mode: 'SUBTREE',
      reports_to_role: null,
    });
    expect(byCode['TEAM_LEADER']).toMatchObject({
      hierarchy_mode: 'DIRECT_TEAM',
      reports_to_role: 'MANAGER',
    });
    for (const code of ['BACKEND_USER', 'FIELD_AGENT', 'KYC_VERIFIER']) {
      expect(byCode[code]).toMatchObject({
        grants_all: false,
        hierarchy_mode: 'SELF',
        reports_to_role: 'TEAM_LEADER',
      });
    }
  });

  it('SUPER_ADMIN holds ZERO explicit rows — grants_all is the only source of its authority', async () => {
    const { rows } = await db!.pool.query(`SELECT 1 FROM role_permissions WHERE role_code = 'SUPER_ADMIN'`);
    expect(rows).toHaveLength(0);
  });

  it('DB-resolved permission set is byte-identical to ROLE_PERMISSIONS for all 6 roles', async () => {
    for (const role of ROLES) {
      const { rows } = await db!.pool.query<{ grants_all: boolean }>(
        `SELECT grants_all FROM roles WHERE code = $1`,
        [role],
      );
      const grantsAll = rows[0]!.grants_all;
      const perms = grantsAll
        ? ALL_PERMISSIONS
        : (
            await db!.pool.query<{ permission_code: string }>(
              `SELECT permission_code FROM role_permissions WHERE role_code = $1`,
              [role],
            )
          ).rows
            .map((r) => r.permission_code)
            .sort();
      expect(perms, `role ${role}`).toEqual([...ROLE_PERMISSIONS[role]].sort());
    }
  });

  it('users.role is now FK-governed: an unknown role code is rejected (not the old CHECK)', async () => {
    const constraints = await db!.pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conname IN ('chk_users_role', 'fk_users_role')`,
    );
    expect(constraints.rows.map((r) => r.conname)).toEqual(['fk_users_role']);
    await expect(
      db!.pool.query(`INSERT INTO users (username, name, role) VALUES ('bogus_role_user', 'X', 'BOGUS')`),
    ).rejects.toMatchObject({ code: '23503' }); // FK violation, fail-closed
  });
});
