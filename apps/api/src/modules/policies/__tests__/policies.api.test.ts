import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

/**
 * Integration: real Express app over an ephemeral Postgres (migrations + truncate).
 * Runs only when DATABASE_URL points at a throwaway test DB (CI provides it).
 */
const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BE = authHeaderForRole('BACKEND_USER');
const newPolicy = (code = 'PRIVACY') => ({ code, name: 'Privacy', content: 'v1 body' });

describe.skipIf(!RUN)('policies admin API', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    // truncate the migration's seeded starter policy + audit_log (int PKs reuse). Acceptances live
    // in the shared `consents` store and aren't part of the admin policy CRUD surface — but the
    // per-user-acceptances tests below DO write consents rows, so wipe them between tests too.
    await db!.truncate('consents', 'policies', 'audit_log');
  });

  it('SUPER_ADMIN creates (201), version=1, content_version=1', async () => {
    const r = await request(app).post('/api/v2/policies').set(SA).send(newPolicy());
    expect(r.status).toBe(201);
    expect(r.body.code).toBe('PRIVACY');
    expect(r.body.version).toBe(1);
    expect(r.body.contentVersion).toBe(1);
    expect(r.body.isActive).toBe(false); // created inactive (default) until explicitly activated

    const list = await request(app).get('/api/v2/policies').set(SA);
    expect(list.status).toBe(200);
    // §4 pagination envelope (PAGINATION_AND_LOADING_STANDARDS).
    expect(list.body.items).toHaveLength(1);
    expect(list.body.totalCount).toBe(1);
    expect(list.body.page).toBe(1);
    expect(list.body.pageSize).toBe(25); // default
    expect(list.body.sort).toEqual({ sortBy: 'createdAt', sortOrder: 'desc' });
  });

  it('rejects an invalid code with 400 VALIDATION', async () => {
    const r = await request(app)
      .post('/api/v2/policies')
      .set(SA)
      .send({ code: 'lower_case', name: 'X', content: 'body' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('VALIDATION');
  });

  it('editing content bumps content_version; metadata-only edit does not', async () => {
    const c = await request(app).post('/api/v2/policies').set(SA).send(newPolicy('POLX'));
    const { id, version } = c.body;

    const meta = await request(app).put(`/api/v2/policies/${id}`).set(SA).send({ name: 'Renamed', version });
    expect(meta.status).toBe(200);
    expect(meta.body.name).toBe('Renamed');
    expect(meta.body.version).toBe(2); // OCC bumps every edit
    expect(meta.body.contentVersion).toBe(1); // unchanged — content untouched

    const edit = await request(app)
      .put(`/api/v2/policies/${id}`)
      .set(SA)
      .send({ content: 'v2 body', version: meta.body.version });
    expect(edit.status).toBe(200);
    expect(edit.body.version).toBe(3);
    expect(edit.body.contentVersion).toBe(2); // bumped — content changed
  });

  it('update without a version → 400 VERSION_REQUIRED', async () => {
    const c = await request(app).post('/api/v2/policies').set(SA).send(newPolicy('NEEDVER'));
    const r = await request(app).put(`/api/v2/policies/${c.body.id}`).set(SA).send({ name: 'X' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('VERSION_REQUIRED');
  });

  it('update a non-existent id with a version → 404 POLICY_NOT_FOUND', async () => {
    const r = await request(app).put('/api/v2/policies/999999').set(SA).send({ name: 'X', version: 1 });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('POLICY_NOT_FOUND');
  });

  it('stale update → 409 STALE_UPDATE with current; re-read succeeds', async () => {
    const c = await request(app).post('/api/v2/policies').set(SA).send(newPolicy('POLY'));
    const a = await request(app)
      .put(`/api/v2/policies/${c.body.id}`)
      .set(SA)
      .send({ name: 'A-edit', version: 1 });
    expect(a.status).toBe(200);
    expect(a.body.version).toBe(2);
    const stale = await request(app)
      .put(`/api/v2/policies/${c.body.id}`)
      .set(SA)
      .send({ name: 'x', version: 999 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('STALE_UPDATE');
    expect(stale.body.current.version).toBe(2);
    expect(stale.body.current.name).toBe('A-edit');
    const ok = await request(app)
      .put(`/api/v2/policies/${c.body.id}`)
      .set(SA)
      .send({ name: 'B-edit', version: stale.body.current.version });
    expect(ok.status).toBe(200);
    expect(ok.body.version).toBe(3);
  });

  it('activate / deactivate toggles is_active (version-guarded, each bumps version)', async () => {
    const c = await request(app).post('/api/v2/policies').set(SA).send(newPolicy('POLACT'));
    const { id, version } = c.body;
    const on = await request(app).post(`/api/v2/policies/${id}/activate`).set(SA).send({ version });
    expect(on.body.isActive).toBe(true);
    expect(on.body.version).toBe(2);
    const off = await request(app)
      .post(`/api/v2/policies/${id}/deactivate`)
      .set(SA)
      .send({ version: on.body.version });
    expect(off.body.isActive).toBe(false);
    expect(off.body.version).toBe(3);
  });

  it('404 for unknown id', async () => {
    expect((await request(app).get('/api/v2/policies/999999').set(SA)).status).toBe(404);
  });

  it('unauthenticated request is 401', async () => {
    expect((await request(app).get('/api/v2/policies')).status).toBe(401);
  });

  it('BACKEND_USER cannot write (403) and cannot view the list (403 — page.policies not granted to BE)', async () => {
    expect((await request(app).post('/api/v2/policies').set(BE).send(newPolicy('POLZ'))).status).toBe(403);
    expect((await request(app).get('/api/v2/policies').set(BE)).status).toBe(403);
  });

  it('every create/update appends exactly one immutable audit_log row', async () => {
    const c = (await request(app).post('/api/v2/policies').set(SA).send(newPolicy('AUDITPOL'))).body;
    await request(app).put(`/api/v2/policies/${c.id}`).set(SA).send({ name: 'Changed', version: c.version });
    const { rows } = await db!.pool.query(
      `SELECT action, version_after FROM audit_log
       WHERE entity_type = 'policies' AND entity_id = $1 ORDER BY id`,
      [String(c.id)],
    );
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
    expect(rows[1].version_after).toBe(2);
  });

  it('paginates + server-sorts by the whitelisted column', async () => {
    for (const code of ['PA', 'PB', 'PC']) {
      await request(app).post('/api/v2/policies').set(SA).send(newPolicy(code));
    }
    const p1 = await request(app).get('/api/v2/policies?limit=2&page=1&sortBy=code&sortOrder=asc').set(SA);
    expect(p1.body.items.map((p: { code: string }) => p.code)).toEqual(['PA', 'PB']);
    expect(p1.body.totalCount).toBe(3);
    expect(p1.body.totalPages).toBe(2);
  });

  it('unknown sortBy falls back to the default sort (no SQL injection surface)', async () => {
    await request(app).post('/api/v2/policies').set(SA).send(newPolicy('SAFE'));
    const res = await request(app).get('/api/v2/policies?sortBy=name;DROP TABLE policies').set(SA);
    expect(res.status).toBe(200);
    expect(res.body.sort.sortBy).toBe('createdAt'); // default, not the injection string
  });

  // ── Admin: per-user acceptance log (ADR-0043) — read-only, joins consents → policies.
  describe('GET /policies/users/:userId/acceptances', () => {
    // The seeded admin user (migration 0007) is a stable uuid we can write consents rows against.
    const ADMIN_ID = '00000000-0000-0000-0000-000000000001';

    interface AcceptanceRow {
      id: string;
      policyId: number | null;
      policyCode: string | null;
      policyName: string | null;
      policyVersion: number;
      acceptedAt: string;
      ip: string | null;
      userAgent: string | null;
    }

    it('returns the user-joined acceptance log, with policy name + id from the join', async () => {
      // create two policies; bump POLB to content_version=2 so the two consents rows (v=1 + v=2) don't
      // collide with the (user, policy_version) uniqueness constraint.
      await request(app).post('/api/v2/policies').set(SA).send(newPolicy('POLA'));
      const b = (await request(app).post('/api/v2/policies').set(SA).send(newPolicy('POLB'))).body;
      await request(app)
        .put(`/api/v2/policies/${b.id}`)
        .set(SA)
        .send({ content: 'v2 body', version: b.version });
      await db!.pool.query(
        `INSERT INTO consents (user_id, policy_version, user_agent) VALUES ($1, 1, 'Mozilla/5.0 admin'), ($1, 2, 'CRM-Mobile/1.0.69')`,
        [ADMIN_ID],
      );

      const r = await request(app).get(`/api/v2/policies/users/${ADMIN_ID}/acceptances`).set(SA);
      expect(r.status).toBe(200);
      const rows = r.body as AcceptanceRow[];
      expect(Array.isArray(rows)).toBe(true);
      expect(rows).toHaveLength(2);
      // Each row joins policy_code/policy_name; POLA at v=1, POLB at v=2.
      const codes = rows.map((x) => x.policyCode).sort();
      expect(codes).toEqual(['POLA', 'POLB']);
      const v2 = rows.find((x) => x.policyVersion === 2);
      expect(v2).toBeDefined();
      expect(v2!.policyName).toBe('Privacy');
      expect(v2!.userAgent).toBe('CRM-Mobile/1.0.69');
      expect(typeof v2!.id).toBe('string');
      expect(typeof v2!.acceptedAt).toBe('string');
      // policyId is the joined policies.id (number); not null for an existing policy.
      expect(typeof v2!.policyId).toBe('number');
    });

    it('returns an empty array for a user with no acceptances', async () => {
      const r = await request(app).get(`/api/v2/policies/users/${ADMIN_ID}/acceptances`).set(SA);
      expect(r.status).toBe(200);
      expect(r.body).toEqual([]);
    });

    it('a consents row at a policy_version with NO matching policy row still surfaces (null policy fields)', async () => {
      // No policies row at content_version=99 → LEFT JOIN yields null code/name/policyId.
      await db!.pool.query(`INSERT INTO consents (user_id, policy_version) VALUES ($1, 99)`, [ADMIN_ID]);
      const r = await request(app).get(`/api/v2/policies/users/${ADMIN_ID}/acceptances`).set(SA);
      expect(r.status).toBe(200);
      const rows = r.body as AcceptanceRow[];
      expect(rows).toHaveLength(1);
      expect(rows[0]!.policyVersion).toBe(99);
      expect(rows[0]!.policyCode).toBeNull();
      expect(rows[0]!.policyName).toBeNull();
      expect(rows[0]!.policyId).toBeNull();
    });

    it('a malformed (non-uuid) userId is a clean 400, never a 500 (uuid-param 500 class)', async () => {
      const r = await request(app).get('/api/v2/policies/users/not-a-uuid/acceptances').set(SA);
      expect(r.status).toBe(400);
    });

    it('requires page.users (BACKEND_USER lacks it → 403)', async () => {
      const r = await request(app).get(`/api/v2/policies/users/${ADMIN_ID}/acceptances`).set(BE);
      expect(r.status).toBe(403);
    });

    it('unauthenticated request is 401', async () => {
      expect((await request(app).get(`/api/v2/policies/users/${ADMIN_ID}/acceptances`)).status).toBe(401);
    });
  });
});
