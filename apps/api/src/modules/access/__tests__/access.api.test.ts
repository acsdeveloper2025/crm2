import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

// Since ADR-0022 the matrix is DB-backed (roles/role_permissions) — needs the test DB.
const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BE = authHeaderForRole('BACKEND_USER');
const EXPECTED_ROLES = 6;

describe.skipIf(!RUN)('access API', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });

  it('SUPER_ADMIN gets the full role→permission matrix (200)', async () => {
    const res = await request(app).get('/api/v2/access/matrix').set(SA);
    expect(res.status).toBe(200);
    expect(res.body.roles).toHaveLength(EXPECTED_ROLES);
    // every permission carries a label + group for display
    expect(res.body.permissions.every((p: { label: string; group: string }) => p.label && p.group)).toBe(
      true,
    );
    // SUPER_ADMIN holds every permission (grants_all); FIELD_AGENT holds case.view + the device's
    // location.capture + task.execute (the field-execution capability, ADR-0032 slice 2c).
    expect(res.body.grants.SUPER_ADMIN).toHaveLength(res.body.permissions.length);
    expect(res.body.grants.FIELD_AGENT).toEqual(['case.view', 'location.capture', 'task.execute']);
    // page.access itself is SUPER_ADMIN-only
    expect(res.body.grants.MANAGER).not.toContain('page.access');
  });

  it('a non-admin role cannot view the matrix (403)', async () => {
    expect((await request(app).get('/api/v2/access/matrix').set(BE)).status).toBe(403);
  });

  it('unauthenticated request is 401', async () => {
    expect((await request(app).get('/api/v2/access/matrix')).status).toBe(401);
  });
});
