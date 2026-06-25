import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const FA = authHeaderForRole('FIELD_AGENT');

describe.skipIf(!RUN)('rate-types CRUD (ADR-0064)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    // Keep the seeded catalog (mig 0014 + 0091 OFFICE) intact — only the audit trail is reset.
    await db!.truncate('audit_log');
  });

  it('GET /api/v2/rate-types returns the seeded catalog paginated (incl OFFICE)', async () => {
    const res = await request(app).get('/api/v2/rate-types?limit=50').set(SA);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(19); // 18 (mig 0014) + OFFICE (mig 0091)
    expect(res.body.items.some((r: { code: string }) => r.code === 'OFFICE')).toBe(true);
    expect(res.body.totalCount).toBeGreaterThanOrEqual(19);
  });

  it('POST creates a rate type (uppercased code), defaults category FIELD, then GET /:id returns it', async () => {
    const res = await request(app)
      .post('/api/v2/rate-types')
      .set(SA)
      .send({ code: 'zztest', name: 'zz test' });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe('ZZTEST');
    expect(res.body.category).toBe('FIELD');
    expect(res.body.version).toBe(1);
    const get = await request(app).get(`/api/v2/rate-types/${res.body.id}`).set(SA);
    expect(get.status).toBe(200);
    expect(get.body.code).toBe('ZZTEST');
  });

  it('POST a duplicate code → 409 RATE_TYPE_EXISTS', async () => {
    const res = await request(app).post('/api/v2/rate-types').set(SA).send({ code: 'LOCAL', name: 'dup' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('RATE_TYPE_EXISTS');
  });

  it('PUT updates name/category but NOT code; stale version → 409', async () => {
    const created = (await request(app).post('/api/v2/rate-types').set(SA).send({ code: 'zzupd', name: 'a' }))
      .body;
    const ok = await request(app)
      .put(`/api/v2/rate-types/${created.id}`)
      .set(SA)
      .send({ name: 'b', category: 'OFFICE', code: 'HACK', version: created.version });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('B');
    expect(ok.body.category).toBe('OFFICE');
    expect(ok.body.code).toBe('ZZUPD'); // code ignored — immutable
    expect(ok.body.version).toBe(2);
    const stale = await request(app)
      .put(`/api/v2/rate-types/${created.id}`)
      .set(SA)
      .send({ name: 'c', category: 'FIELD', version: created.version });
    expect(stale.status).toBe(409);
  });

  it('deactivate/activate are version-guarded', async () => {
    const c = (await request(app).post('/api/v2/rate-types').set(SA).send({ code: 'zzact', name: 'x' })).body;
    const d = await request(app)
      .post(`/api/v2/rate-types/${c.id}/deactivate`)
      .set(SA)
      .send({ version: c.version });
    expect(d.status).toBe(200);
    expect(d.body.isActive).toBe(false);
    const a = await request(app)
      .post(`/api/v2/rate-types/${c.id}/activate`)
      .set(SA)
      .send({ version: d.body.version });
    expect(a.status).toBe(200);
    expect(a.body.isActive).toBe(true);
  });

  it('GET /options returns the lean usable shape (id/code/category)', async () => {
    const res = await request(app).get('/api/v2/rate-types/options?active=true').set(SA);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const office = res.body.find((o: { code: string }) => o.code === 'OFFICE');
    expect(office).toMatchObject({ code: 'OFFICE', category: 'OFFICE' });
    expect(office.id).toBeTypeOf('number');
  });

  it('RBAC: a non-masterdata role cannot write (403)', async () => {
    const res = await request(app).post('/api/v2/rate-types').set(FA).send({ code: 'zzno', name: 'no' });
    expect(res.status).toBe(403);
  });
});
