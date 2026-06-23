import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';
import { invalidateRoleCache } from '../../../platform/access/index.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const FA = authHeaderForRole('FIELD_AGENT');

/** The FIELD_AGENT seed grant — restored after every test so other suites (and the parity
 *  test) always see the pristine seed regardless of execution order. */
const FIELD_AGENT_SEED = ['case.view', 'location.capture', 'task.execute'];

async function currentVersion(code: string): Promise<number> {
  const res = await db!.pool.query<{ version: number }>(`SELECT version FROM roles WHERE code = $1`, [code]);
  return res.rows[0]!.version;
}

describe.skipIf(!RUN)('roles API (ADR-0022 slice 2 — editable role→permission mapping)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    // the lifecycle/E2E tests create users/cases/catalog rows — start every test clean
    await db!.truncate(
      'user_scope_assignments',
      'case_tasks',
      'case_applicants',
      'cases',
      'clients',
      'products',
      'locations',
      'users',
    );
    await db!.pool.query(`DELETE FROM roles WHERE is_system = false`);
    invalidateRoleCache();
  });
  afterEach(async () => {
    // restore the seed mapping for any role this file may have touched + drop the cache
    await db!.pool.query(`DELETE FROM role_permissions WHERE role_code = 'FIELD_AGENT'`);
    await db!.pool.query(
      `INSERT INTO role_permissions (role_code, permission_code)
       SELECT 'FIELD_AGENT', x FROM unnest($1::text[]) AS x ON CONFLICT DO NOTHING`,
      [FIELD_AGENT_SEED],
    );
    invalidateRoleCache();
  });

  it('lists the 6 roles (paginated) with permissions + dimension wiring (SA grants_all, zero rows)', async () => {
    const res = await request(app).get('/api/v2/roles').set(SA);
    expect(res.status).toBe(200);
    expect(res.body.totalCount).toBe(6);
    const byCode = Object.fromEntries(
      (
        res.body.items as {
          code: string;
          grantsAll: boolean;
          permissions: string[];
          dimensions: { dimension: string; mode: string }[];
        }[]
      ).map((r) => [r.code, r]),
    );
    expect(byCode['SUPER_ADMIN']).toMatchObject({ grantsAll: true, permissions: [], isSystem: true });
    expect(byCode['FIELD_AGENT']!.permissions).toEqual(FIELD_AGENT_SEED);
    expect(byCode['FIELD_AGENT']!.dimensions).toEqual([
      { dimension: 'AREA', mode: 'EXPAND' },
      { dimension: 'PINCODE', mode: 'EXPAND' },
    ]);
    expect(byCode['MANAGER']!.permissions).toContain('case.assign');
    // search narrows
    expect((await request(app).get('/api/v2/roles?search=lead').set(SA)).body.totalCount).toBe(1);
    // reads need page.access — a field agent holds only case.view
    expect((await request(app).get('/api/v2/roles').set(FA)).status).toBe(403);
    expect((await request(app).get('/api/v2/roles')).status).toBe(401);
    // the dimension catalog feed serves the role dialog
    const dims = await request(app).get('/api/v2/roles/dimensions').set(SA);
    expect(dims.body.map((d: { code: string }) => d.code)).toContain('PINCODE');
    // the Created date filter is wired (not silently dropped)
    const dated = await request(app).get('/api/v2/roles?f_createdAt_from=2099-01-01').set(SA);
    expect(dated.body.totalCount).toBe(0);
    // the DataGrid export streams an xlsx (IMPORT_EXPORT_STANDARD)
    const exp = await request(app)
      .get('/api/v2/roles/export?mode=all&format=xlsx')
      .set(SA)
      .buffer(true)
      .parse((res2, cb) => {
        const chunks: Buffer[] = [];
        res2.on('data', (c: Buffer) => chunks.push(c));
        res2.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(exp.status).toBe(200);
    expect((exp.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
  });

  it('a data.export-only role without page.access cannot export roles (403) — RBAC topology is not export-widened', async () => {
    // MANAGER holds data.export but NOT page.access; the roles export carries the full permission
    // topology, so it must share the read audience (the exact scope/billing export precedent).
    const exp = await request(app)
      .get('/api/v2/roles/export?mode=all&format=xlsx')
      .set(authHeaderForRole('MANAGER'));
    expect(exp.status).toBe(403);
  });

  it('editing a role’s permissions takes LIVE effect (grant → 200, revoke → 403) — the authorize() cutover', async () => {
    // baseline: a field agent can list cases (case.view) but not create them (no case.create)
    expect((await request(app).get('/api/v2/cases').set(FA)).status).toBe(200);
    expect((await request(app).post('/api/v2/cases').set(FA).send({})).status).toBe(403);

    // grant case.create to FIELD_AGENT
    const v1 = await currentVersion('FIELD_AGENT');
    const grant = await request(app)
      .put('/api/v2/roles/FIELD_AGENT/permissions')
      .set(SA)
      .send({ permissions: ['case.view', 'case.create'], version: v1 });
    expect(grant.status).toBe(200);
    expect(grant.body.permissions).toEqual(['case.create', 'case.view']);
    // now the 403 flips to a validation-level response (the guard passed; the body is empty)
    const afterGrant = await request(app).post('/api/v2/cases').set(FA).send({});
    expect(afterGrant.status).not.toBe(403);

    // revoke case.view — the case list goes dark for the role
    const v2 = await currentVersion('FIELD_AGENT');
    await request(app)
      .put('/api/v2/roles/FIELD_AGENT/permissions')
      .set(SA)
      .send({ permissions: ['case.create'], version: v2 });
    expect((await request(app).get('/api/v2/cases').set(FA)).status).toBe(403);

    // and an audit row recorded the config change
    const audit = await db!.pool.query(
      `SELECT 1 FROM audit_log WHERE entity_type = 'roles' AND entity_id = 'FIELD_AGENT' AND action = 'UPDATE'`,
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  it('guards: unknown permission → 400, SUPER_ADMIN locked → 400, unknown role → 404, stale version → 409, bad code → 400', async () => {
    const v = await currentVersion('FIELD_AGENT');
    const bad = await request(app)
      .put('/api/v2/roles/FIELD_AGENT/permissions')
      .set(SA)
      .send({ permissions: ['not.a.permission'], version: v });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('INVALID_PERMISSION');

    const locked = await request(app)
      .put('/api/v2/roles/SUPER_ADMIN/permissions')
      .set(SA)
      .send({ permissions: ['case.view'], version: 1 });
    expect(locked.status).toBe(400);
    expect(locked.body.error).toBe('ROLE_LOCKED');

    const missing = await request(app)
      .put('/api/v2/roles/NO_SUCH_ROLE/permissions')
      .set(SA)
      .send({ permissions: ['case.view'], version: 1 });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('ROLE_NOT_FOUND');

    const stale = await request(app)
      .put('/api/v2/roles/FIELD_AGENT/permissions')
      .set(SA)
      .send({ permissions: ['case.view'], version: v + 999 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('STALE_UPDATE');

    expect(
      (
        await request(app)
          .put('/api/v2/roles/lower-case!/permissions')
          .set(SA)
          .send({ permissions: [], version: 1 })
      ).status,
    ).toBe(400);

    // writes need role.manage — only grants_all (SUPER_ADMIN) holds it day-0
    expect(
      (
        await request(app)
          .put('/api/v2/roles/FIELD_AGENT/permissions')
          .set(authHeaderForRole('MANAGER'))
          .send({ permissions: ['case.view'], version: v })
      ).status,
    ).toBe(403);
  });

  it('an unknown role code on the auth seam resolves to ZERO permissions (fail-closed), never a 500', async () => {
    const res = await request(app)
      .get('/api/v2/cases')
      .set({ 'x-test-auth': 'GHOST_ROLE:00000000-0000-0000-0000-0000000000aa' });
    expect(res.status).toBe(403);
  });

  it('custom-role lifecycle: create with config, edit, guard matrix, deactivate rules (ADR-0022 slice 5)', async () => {
    // create: permissions + dimension wiring + hierarchy mode in one act
    const created = await request(app)
      .post('/api/v2/roles')
      .set(SA)
      .send({
        code: 'ZONE_AUDITOR',
        name: 'Zone Auditor',
        description: 'Sees all cases, capped to assigned pincodes',
        hierarchyMode: 'ALL',
        permissions: ['case.view'],
        dimensions: [{ dimension: 'PINCODE', mode: 'RESTRICT' }],
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      code: 'ZONE_AUDITOR',
      isSystem: false,
      hierarchyMode: 'ALL',
      permissions: ['case.view'],
      dimensions: [{ dimension: 'PINCODE', mode: 'RESTRICT' }],
    });

    // duplicate code → 409; bad permission/dimension/reports-to → 400
    expect(
      (
        await request(app)
          .post('/api/v2/roles')
          .set(SA)
          .send({ code: 'ZONE_AUDITOR', name: 'X', hierarchyMode: 'SELF' })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(app)
          .post('/api/v2/roles')
          .set(SA)
          .send({ code: 'BAD_PERM', name: 'X', hierarchyMode: 'SELF', permissions: ['not.real'] })
      ).body.error,
    ).toBe('INVALID_PERMISSION');
    expect(
      (
        await request(app)
          .post('/api/v2/roles')
          .set(SA)
          .send({
            code: 'BAD_DIM',
            name: 'X',
            hierarchyMode: 'SELF',
            dimensions: [{ dimension: 'GALAXY', mode: 'EXPAND' }],
          })
      ).body.error,
    ).toBe('UNKNOWN_DIMENSION');
    expect(
      (
        await request(app)
          .post('/api/v2/roles')
          .set(SA)
          .send({ code: 'SELF_REF', name: 'X', hierarchyMode: 'SELF', reportsToRole: 'SELF_REF' })
      ).body.error,
    ).toBe('INVALID_REPORTS_TO_ROLE');

    // edit config: rename + change wiring mode (OCC)
    const v = created.body.version as number;
    const edited = await request(app)
      .put('/api/v2/roles/ZONE_AUDITOR')
      .set(SA)
      .send({
        name: 'Zonal Auditor',
        hierarchyMode: 'ALL',
        dimensions: [{ dimension: 'PINCODE', mode: 'EXPAND' }],
        version: v,
      });
    expect(edited.status).toBe(200);
    expect(edited.body.name).toBe('ZONAL AUDITOR');
    expect(edited.body.dimensions).toEqual([{ dimension: 'PINCODE', mode: 'EXPAND' }]);

    // system roles: never deactivatable; SUPER_ADMIN: fully locked
    expect(
      (await request(app).post('/api/v2/roles/MANAGER/deactivate').set(SA).send({ version: 1 })).body.error,
    ).toBe('ROLE_LOCKED');
    expect(
      (
        await request(app)
          .put('/api/v2/roles/SUPER_ADMIN')
          .set(SA)
          .send({ name: 'X', hierarchyMode: 'ALL', version: 1 })
      ).body.error,
    ).toBe('ROLE_LOCKED');

    // a custom role with ACTIVE users cannot be deactivated (fail-closed for operations)
    await db!.pool.query(
      `INSERT INTO users (username, name, role) VALUES ('zone_user_1', 'Z USER', 'ZONE_AUDITOR')`,
    );
    const blocked = await request(app)
      .post('/api/v2/roles/ZONE_AUDITOR/deactivate')
      .set(SA)
      .send({ version: edited.body.version });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('ROLE_IN_USE');
    // …until its users are gone
    await db!.pool.query(`DELETE FROM users WHERE role = 'ZONE_AUDITOR'`);
    const off = await request(app)
      .post('/api/v2/roles/ZONE_AUDITOR/deactivate')
      .set(SA)
      .send({ version: edited.body.version });
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);
    // an inactive role disappears from the options feed
    const opts = await request(app).get('/api/v2/roles/options').set(SA);
    expect(opts.body.map((o: { code: string }) => o.code)).not.toContain('ZONE_AUDITOR');

    // cleanup so other suites see only the 6 seed roles
    await db!.pool.query(`DELETE FROM roles WHERE is_system = false`);
    invalidateRoleCache();
  });

  it('ZERO-CODE proof: an admin-created role works end-to-end (user + scope + visibility)', async () => {
    // 1. admin creates the role: sees ALL cases, capped (RESTRICT) to assigned pincodes
    const role = await request(app)
      .post('/api/v2/roles')
      .set(SA)
      .send({
        code: 'ZONE_AUDITOR',
        name: 'Zone Auditor',
        hierarchyMode: 'ALL',
        permissions: ['case.view'],
        dimensions: [{ dimension: 'PINCODE', mode: 'RESTRICT' }],
      });
    expect(role.status).toBe(201);

    // 2. admin creates a USER with the custom role (open role catalog)
    const user = await request(app)
      .post('/api/v2/users')
      .set(SA)
      .send({ username: 'zone_auditor_1', name: 'ZONE AUDITOR ONE', role: 'ZONE_AUDITOR' });
    expect(user.status).toBe(201);
    const uid = user.body.id as string;

    // 3. two located cases (different pincodes), created by SA, assigned to nobody
    const locId = async (pincode: string): Promise<number> =>
      (
        await db!.pool.query<{ id: number }>(
          `INSERT INTO locations (pincode, area, city, state, country)
           VALUES ($1, 'Sector 1', 'Pune', 'Maharashtra', 'India') RETURNING id`,
          [pincode],
        )
      ).rows[0]!.id;
    const pinIn = await locId('411001');
    const pinOut = await locId('411002');
    const clientId = (
      await request(app).post('/api/v2/clients').set(SA).send({ code: 'ZC1', name: 'Zone Client' })
    ).body.id as number;
    const productId = (
      await request(app).post('/api/v2/products').set(SA).send({ code: 'ZP1', name: 'Zone Product' })
    ).body.id as number;
    const mkCase = async (pincodeId: number, name: string): Promise<string> =>
      (
        await request(app)
          .post('/api/v2/cases')
          .set(SA)
          .send({
            clientId,
            productId,
            backendContactNumber: '9876543210',
            applicants: [{ name }],
            dedupeDecision: 'NO_DUPLICATES_FOUND',
            pincodeId,
          })
      ).body.id as string;
    const caseIn = await mkCase(pinIn, 'ZONE IN');
    const caseOut = await mkCase(pinOut, 'ZONE OUT');

    // 4. before any assignment: RESTRICT + nothing assigned ⇒ the auditor sees NOTHING
    const auth = { 'x-test-auth': `ZONE_AUDITOR:${uid}` };
    const before = await request(app).get('/api/v2/cases').set(auth);
    expect(before.status).toBe(200); // case.view granted to the custom role
    expect(before.body.items).toEqual([]);

    // 5. admin assigns ONE pincode (the role's wiring allows PINCODE — no code involved)
    const assign = await request(app)
      .post(`/api/v2/users/${uid}/scope-assignments`)
      .set(SA)
      .send({ dimension: 'PINCODE', entityIds: [pinIn] });
    expect(assign.status).toBe(200);

    // 6. the auditor now sees EXACTLY the in-territory case (hierarchy ALL, capped by RESTRICT)
    const after = await request(app).get('/api/v2/cases').set(auth);
    const ids = (after.body.items as { id: string }[]).map((c) => c.id);
    expect(ids).toContain(caseIn);
    expect(ids).not.toContain(caseOut);
    expect((await request(app).get(`/api/v2/cases/${caseIn}`).set(auth)).status).toBe(200);
    expect((await request(app).get(`/api/v2/cases/${caseOut}`).set(auth)).status).toBe(404);
    // …and cannot create cases (the role was never granted case.create)
    expect((await request(app).post('/api/v2/cases').set(auth).send({})).status).toBe(403);

    // cleanup: remove the custom-role user + role so other suites see the pristine seed
    await db!.pool.query(`DELETE FROM users WHERE role = 'ZONE_AUDITOR'`);
    await db!.pool.query(`DELETE FROM roles WHERE is_system = false`);
    invalidateRoleCache();
  });

  it('password expiry: per-role policy (seed 90 office / null exempt; settable + editable + bounded)', async () => {
    // migration seed: office roles rotate every 90 days; field agents + super admin are exempt (null)
    const list = await request(app).get('/api/v2/roles?limit=200').set(SA);
    const byCode = Object.fromEntries(
      (list.body.items as { code: string; passwordExpiryDays: number | null }[]).map((r) => [r.code, r]),
    );
    expect(byCode['MANAGER']!.passwordExpiryDays).toBe(90);
    expect(byCode['KYC_VERIFIER']!.passwordExpiryDays).toBe(90);
    expect(byCode['FIELD_AGENT']!.passwordExpiryDays).toBeNull();
    expect(byCode['SUPER_ADMIN']!.passwordExpiryDays).toBeNull();

    // create with an explicit policy; omit ⇒ null (never)
    const created = await request(app)
      .post('/api/v2/roles')
      .set(SA)
      .send({ code: 'PWX_ROLE', name: 'Pwx', hierarchyMode: 'SELF', passwordExpiryDays: 45 });
    expect(created.status).toBe(201);
    expect(created.body.passwordExpiryDays).toBe(45);
    const noPolicy = await request(app)
      .post('/api/v2/roles')
      .set(SA)
      .send({ code: 'PWX_NULL', name: 'Pwx Null', hierarchyMode: 'SELF' });
    expect(noPolicy.body.passwordExpiryDays).toBeNull();

    // edit changes it; null clears it back to never
    const edited = await request(app)
      .put('/api/v2/roles/PWX_ROLE')
      .set(SA)
      .send({ name: 'Pwx', hierarchyMode: 'SELF', passwordExpiryDays: 30, version: created.body.version });
    expect(edited.body.passwordExpiryDays).toBe(30);
    const cleared = await request(app)
      .put('/api/v2/roles/PWX_ROLE')
      .set(SA)
      .send({ name: 'Pwx', hierarchyMode: 'SELF', passwordExpiryDays: null, version: edited.body.version });
    expect(cleared.body.passwordExpiryDays).toBeNull();

    // out-of-range is rejected (1–3650)
    expect(
      (
        await request(app)
          .post('/api/v2/roles')
          .set(SA)
          .send({ code: 'PWX_BAD', name: 'X', hierarchyMode: 'SELF', passwordExpiryDays: 0 })
      ).status,
    ).toBe(400);
  });

  it('idle-logout + session cap: per-role policy (seed 10/720 desk, null exempt; settable/editable/bounded)', async () => {
    // migration 0075 seed: DESK roles + SUPER_ADMIN get 10-min idle + 720-min cap; FIELD_AGENT exempt
    const list = await request(app).get('/api/v2/roles?limit=200').set(SA);
    const byCode = Object.fromEntries(
      (
        list.body.items as {
          code: string;
          idleLogoutMinutes: number | null;
          maxSessionMinutes: number | null;
        }[]
      ).map((r) => [r.code, r]),
    );
    expect(byCode['MANAGER']!.idleLogoutMinutes).toBe(10);
    expect(byCode['MANAGER']!.maxSessionMinutes).toBe(720);
    expect(byCode['SUPER_ADMIN']!.idleLogoutMinutes).toBe(10);
    expect(byCode['FIELD_AGENT']!.idleLogoutMinutes).toBeNull();
    expect(byCode['FIELD_AGENT']!.maxSessionMinutes).toBeNull();

    // create with an explicit policy; omit ⇒ null
    const created = await request(app).post('/api/v2/roles').set(SA).send({
      code: 'IDLE_ROLE',
      name: 'Idle',
      hierarchyMode: 'SELF',
      idleLogoutMinutes: 12,
      maxSessionMinutes: 480,
    });
    expect(created.status).toBe(201);
    expect(created.body.idleLogoutMinutes).toBe(12);
    expect(created.body.maxSessionMinutes).toBe(480);
    const noPolicy = await request(app)
      .post('/api/v2/roles')
      .set(SA)
      .send({ code: 'IDLE_NULL', name: 'Idle Null', hierarchyMode: 'SELF' });
    expect(noPolicy.body.idleLogoutMinutes).toBeNull();
    expect(noPolicy.body.maxSessionMinutes).toBeNull();

    // edit changes idle (omitted maxSessionMinutes left unchanged); null clears idle back to exempt
    const edited = await request(app)
      .put('/api/v2/roles/IDLE_ROLE')
      .set(SA)
      .send({ name: 'Idle', hierarchyMode: 'SELF', idleLogoutMinutes: 20, version: created.body.version });
    expect(edited.body.idleLogoutMinutes).toBe(20);
    expect(edited.body.maxSessionMinutes).toBe(480);
    const cleared = await request(app)
      .put('/api/v2/roles/IDLE_ROLE')
      .set(SA)
      .send({ name: 'Idle', hierarchyMode: 'SELF', idleLogoutMinutes: null, version: edited.body.version });
    expect(cleared.body.idleLogoutMinutes).toBeNull();

    // out-of-range is rejected (idle 1–1440)
    expect(
      (
        await request(app)
          .post('/api/v2/roles')
          .set(SA)
          .send({ code: 'IDLE_BAD', name: 'X', hierarchyMode: 'SELF', idleLogoutMinutes: 0 })
      ).status,
    ).toBe(400);
  });

  // ── GET /roles/:code — single role by code (the Roles record-page loader). Read = ACCESS_VIEW.
  describe('GET /roles/:code', () => {
    it('returns 200 + the full RoleView (permissions + dimension wiring) for a seeded role', async () => {
      const r = await request(app).get('/api/v2/roles/FIELD_AGENT').set(SA);
      expect(r.status).toBe(200);
      expect(r.body.code).toBe('FIELD_AGENT');
      expect(r.body.isSystem).toBe(true);
      expect(r.body.permissions).toEqual(FIELD_AGENT_SEED);
      expect(r.body.dimensions).toEqual([
        { dimension: 'AREA', mode: 'EXPAND' },
        { dimension: 'PINCODE', mode: 'EXPAND' },
      ]);
    });

    it('reads a grants_all role (SUPER_ADMIN) — never ROLE_LOCKED on a plain read', async () => {
      const r = await request(app).get('/api/v2/roles/SUPER_ADMIN').set(SA);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ code: 'SUPER_ADMIN', grantsAll: true, isSystem: true });
      expect(r.body.permissions).toEqual([]);
    });

    it('reads a freshly created custom role by code', async () => {
      await request(app)
        .post('/api/v2/roles')
        .set(SA)
        .send({
          code: 'READ_ROLE',
          name: 'Read Role',
          hierarchyMode: 'ALL',
          permissions: ['case.view'],
          dimensions: [{ dimension: 'PINCODE', mode: 'RESTRICT' }],
        });
      const r = await request(app).get('/api/v2/roles/READ_ROLE').set(SA);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        code: 'READ_ROLE',
        isSystem: false,
        permissions: ['case.view'],
        dimensions: [{ dimension: 'PINCODE', mode: 'RESTRICT' }],
      });
    });

    it('404 ROLE_NOT_FOUND for an unknown code', async () => {
      const r = await request(app).get('/api/v2/roles/NO_SUCH_ROLE').set(SA);
      expect(r.status).toBe(404);
      expect(r.body.error).toBe('ROLE_NOT_FOUND');
    });

    it('400 for a malformed code (never a 500)', async () => {
      expect((await request(app).get('/api/v2/roles/lower-case!').set(SA)).status).toBe(400);
    });

    it('unauthenticated request is 401', async () => {
      expect((await request(app).get('/api/v2/roles/FIELD_AGENT')).status).toBe(401);
    });

    it('a role lacking page.access cannot read (FIELD_AGENT → 403)', async () => {
      expect((await request(app).get('/api/v2/roles/FIELD_AGENT').set(FA)).status).toBe(403);
    });
  });
});
