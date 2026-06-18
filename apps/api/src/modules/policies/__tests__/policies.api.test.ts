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
    // truncate the migration's seeded starter policy + its acceptances + audit_log (int PKs reuse).
    await db!.truncate('policy_acceptances', 'policies', 'audit_log');
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

  it('GET /:id/acceptances returns the immutable acceptance audit (most-recent first)', async () => {
    const c = await request(app).post('/api/v2/policies').set(SA).send(newPolicy('POLACC'));
    const id = c.body.id as number;
    const userId = '00000000-0000-0000-0000-000000000001';
    await db!.pool.query(
      `INSERT INTO policy_acceptances (user_id, policy_id, content_version, source) VALUES ($1,$2,1,'WEB')`,
      [userId, id],
    );
    const res = await request(app).get(`/api/v2/policies/${id}/acceptances`).set(SA);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({ policyId: id, contentVersion: 1, source: 'WEB' });
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
});
