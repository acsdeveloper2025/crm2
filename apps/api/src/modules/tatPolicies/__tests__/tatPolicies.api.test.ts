import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';
import { listUsableHours } from '../service.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const FA = authHeaderForRole('FIELD_AGENT'); // holds neither masterdata perm

describe.skipIf(!RUN)('tat-policies API (ADR-0044)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    // truncate clears the migration seed → tests create their own rows
    await db!.truncate('tat_policies');
  });

  it('creates a TAT policy (201) at version 1 and lists it', async () => {
    const created = await request(app)
      .post('/api/v2/tat-policies')
      .set(SA)
      .send({ tatHours: 24, label: '24 hours' });
    expect(created.status).toBe(201);
    expect(created.body.tatHours).toBe(24);
    expect(created.body.label).toBe('24 hours');
    expect(created.body.isActive).toBe(true);
    expect(created.body.version).toBe(1);

    const list = await request(app).get('/api/v2/tat-policies').set(SA);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].tatHours).toBe(24);
    expect(list.body.sort).toEqual({ sortBy: 'tatHours', sortOrder: 'asc' });
  });

  it('rejects a second active policy for the same tat_hours (409)', async () => {
    const first = await request(app)
      .post('/api/v2/tat-policies')
      .set(SA)
      .send({ tatHours: 12, label: '12 hours' });
    expect(first.status).toBe(201);
    const dup = await request(app)
      .post('/api/v2/tat-policies')
      .set(SA)
      .send({ tatHours: 12, label: 'half a day' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('TAT_POLICY_EXISTS');
  });

  it('revise bumps the version, end-dates the old row; stale version → 409', async () => {
    const created = await request(app)
      .post('/api/v2/tat-policies')
      .set(SA)
      .send({ tatHours: 8, label: '8 hours' });
    const id = created.body.id as number;

    const revised = await request(app)
      .post(`/api/v2/tat-policies/${id}/revise`)
      .set(SA)
      .send({ label: 'eight hours', version: 1 });
    expect(revised.status).toBe(200);
    expect(revised.body.label).toBe('eight hours');
    expect(revised.body.id).not.toBe(id); // a NEW dated row
    expect(revised.body.version).toBe(1);

    // current list shows only the new row; history shows both
    const current = await request(app).get('/api/v2/tat-policies').set(SA);
    expect(current.body.items).toHaveLength(1);
    expect(current.body.items[0].label).toBe('eight hours');
    const withHistory = await request(app).get('/api/v2/tat-policies?history=true').set(SA);
    expect(withHistory.body.items.length).toBe(2);

    // revising the now-end-dated original with a stale version → 409
    const stale = await request(app)
      .post(`/api/v2/tat-policies/${id}/revise`)
      .set(SA)
      .send({ label: 'nope', version: 1 });
    expect(stale.status).toBe(409);
  });

  it('deactivate (OCC) hides the row from the default list; reactivation allowed', async () => {
    const created = await request(app)
      .post('/api/v2/tat-policies')
      .set(SA)
      .send({ tatHours: 6, label: '6 hours' });
    const id = created.body.id as number;

    // usable hours sees it before deactivation
    expect(await listUsableHours()).toEqual([6]);

    const off = await request(app).post(`/api/v2/tat-policies/${id}/deactivate`).set(SA).send({ version: 1 });
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);

    // default list still includes it (it's not end-dated), but it shows inactive
    const list = await request(app).get('/api/v2/tat-policies?active=true').set(SA);
    expect(list.body.items).toHaveLength(0);
    // and it drops out of the usable-hours classifier source
    expect(await listUsableHours()).toEqual([]);

    const on = await request(app).post(`/api/v2/tat-policies/${id}/activate`).set(SA).send({ version: 2 });
    expect(on.status).toBe(200);
    expect(on.body.isActive).toBe(true);
    expect(await listUsableHours()).toEqual([6]);
  });

  it('a non-masterdata role (FIELD_AGENT) is denied read + write (403)', async () => {
    const denied = await request(app)
      .post('/api/v2/tat-policies')
      .set(FA)
      .send({ tatHours: 48, label: '48 hours' });
    expect(denied.status).toBe(403);
    expect((await request(app).get('/api/v2/tat-policies').set(FA)).status).toBe(403);
  });

  it('validates input: bad tatHours → 400', async () => {
    const bad = await request(app).post('/api/v2/tat-policies').set(SA).send({ tatHours: 0, label: 'zero' });
    expect(bad.status).toBe(400);
  });

  it('listUsableHours returns ascending active in-effect band hours', async () => {
    await request(app).post('/api/v2/tat-policies').set(SA).send({ tatHours: 24, label: '24 hours' });
    await request(app).post('/api/v2/tat-policies').set(SA).send({ tatHours: 4, label: '4 hours' });
    await request(app).post('/api/v2/tat-policies').set(SA).send({ tatHours: 12, label: '12 hours' });
    // future-dated band is not yet in effect → excluded
    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await request(app)
      .post('/api/v2/tat-policies')
      .set(SA)
      .send({ tatHours: 48, label: '48 hours', effectiveFrom: future });
    expect(await listUsableHours()).toEqual([4, 12, 24]);
  });
});
