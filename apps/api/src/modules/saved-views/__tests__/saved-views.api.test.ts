import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const hdr = (id: string): Record<string, string> => ({ 'x-test-auth': `FIELD_AGENT:${id}` });

async function createUser(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/v2/users')
    .set(SA)
    .send({ username, name: username, email: `${username}@test.crm2.local`, role: 'FIELD_AGENT' });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe.skipIf(!RUN)('saved views (B-5) — own-user scoped', () => {
  let userA: string;
  let userB: string;

  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
    userA = await createUser('sv_a');
    userB = await createUser('sv_b');
  });
  afterAll(async () => {
    await db!.end();
  });

  it('401s when unauthenticated', async () => {
    expect((await request(app).get('/api/v2/saved-views?resourceKey=cases')).status).toBe(401);
  });

  it('400s a list with no resourceKey', async () => {
    const res = await request(app).get('/api/v2/saved-views').set(hdr(userA));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('RESOURCE_KEY_REQUIRED');
  });

  it('creates, lists by resource, and isolates per user', async () => {
    const created = await request(app)
      .post('/api/v2/saved-views')
      .set(hdr(userA))
      .send({ resourceKey: 'cases', name: 'My Pending', state: { q: 'x', sort: 'name', dir: 'asc' } });
    expect(created.status).toBe(201);
    expect(created.body.isDefault).toBe(false);
    expect(created.body.state).toEqual({ q: 'x', sort: 'name', dir: 'asc' });

    // A sees it; a different resource is empty; B sees nothing of A's.
    const listA = await request(app).get('/api/v2/saved-views?resourceKey=cases').set(hdr(userA));
    expect(listA.status).toBe(200);
    expect(listA.body).toHaveLength(1);
    const otherResource = await request(app).get('/api/v2/saved-views?resourceKey=tasks').set(hdr(userA));
    expect(otherResource.body).toHaveLength(0);
    const listB = await request(app).get('/api/v2/saved-views?resourceKey=cases').set(hdr(userB));
    expect(listB.body).toHaveLength(0);
  });

  it('409s a duplicate name on the same grid; allows the same name on another grid / another user', async () => {
    await request(app)
      .post('/api/v2/saved-views')
      .set(hdr(userA))
      .send({ resourceKey: 'rates', name: 'Dupe', state: {} });
    const dup = await request(app)
      .post('/api/v2/saved-views')
      .set(hdr(userA))
      .send({ resourceKey: 'rates', name: 'Dupe', state: {} });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('SAVED_VIEW_NAME_EXISTS');
    // same name, different grid → OK
    const otherGrid = await request(app)
      .post('/api/v2/saved-views')
      .set(hdr(userA))
      .send({ resourceKey: 'roles', name: 'Dupe', state: {} });
    expect(otherGrid.status).toBe(201);
    // same name, different user → OK
    const otherUser = await request(app)
      .post('/api/v2/saved-views')
      .set(hdr(userB))
      .send({ resourceKey: 'rates', name: 'Dupe', state: {} });
    expect(otherUser.status).toBe(201);
  });

  it('updates (rename + re-capture) own view; 404s a non-owner / unknown / bad-uuid id', async () => {
    const created = await request(app)
      .post('/api/v2/saved-views')
      .set(hdr(userA))
      .send({ resourceKey: 'users', name: 'Before', state: { q: 'old' } });
    const id = created.body.id as string;

    const renamed = await request(app)
      .put(`/api/v2/saved-views/${id}`)
      .set(hdr(userA))
      .send({ name: 'After', state: { q: 'new', size: '50' } });
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('After');
    expect(renamed.body.state).toEqual({ q: 'new', size: '50' });

    // B can't touch A's view → 404 (IDOR-safe).
    expect(
      (await request(app).put(`/api/v2/saved-views/${id}`).set(hdr(userB)).send({ name: 'Hax' })).status,
    ).toBe(404);
    // unknown uuid → 404
    expect(
      (
        await request(app)
          .put('/api/v2/saved-views/00000000-0000-0000-0000-0000000000ff')
          .set(hdr(userA))
          .send({ name: 'X' })
      ).status,
    ).toBe(404);
    // non-uuid id → clean 404, not a 500
    expect(
      (await request(app).put('/api/v2/saved-views/not-a-uuid').set(hdr(userA)).send({ name: 'X' })).status,
    ).toBe(404);
    // empty update body → 400
    expect((await request(app).put(`/api/v2/saved-views/${id}`).set(hdr(userA)).send({})).status).toBe(400);
  });

  it('set-default holds at most one default per (user, grid); switching clears the prior', async () => {
    const v1 = await request(app)
      .post('/api/v2/saved-views')
      .set(hdr(userA))
      .send({ resourceKey: 'locations', name: 'V1', state: {}, isDefault: true });
    expect(v1.body.isDefault).toBe(true);
    // a second default-on-create clears V1
    const v2 = await request(app)
      .post('/api/v2/saved-views')
      .set(hdr(userA))
      .send({ resourceKey: 'locations', name: 'V2', state: {}, isDefault: true });
    expect(v2.body.isDefault).toBe(true);

    const list = await request(app).get('/api/v2/saved-views?resourceKey=locations').set(hdr(userA));
    const defaults = (list.body as { isDefault: boolean }[]).filter((v) => v.isDefault);
    expect(defaults).toHaveLength(1);
    expect((list.body as { name: string; isDefault: boolean }[]).find((v) => v.isDefault)?.name).toBe('V2');

    // explicit set-default back to V1 clears V2
    const back = await request(app)
      .post(`/api/v2/saved-views/${v1.body.id}/set-default`)
      .set(hdr(userA))
      .send({ isDefault: true });
    expect(back.body.isDefault).toBe(true);
    const list2 = await request(app).get('/api/v2/saved-views?resourceKey=locations').set(hdr(userA));
    expect((list2.body as { isDefault: boolean }[]).filter((v) => v.isDefault)).toHaveLength(1);

    // clear the default entirely
    const cleared = await request(app)
      .post(`/api/v2/saved-views/${v1.body.id}/set-default`)
      .set(hdr(userA))
      .send({ isDefault: false });
    expect(cleared.body.isDefault).toBe(false);
    const list3 = await request(app).get('/api/v2/saved-views?resourceKey=locations').set(hdr(userA));
    expect((list3.body as { isDefault: boolean }[]).filter((v) => v.isDefault)).toHaveLength(0);

    // a non-owner set-default → 404
    expect(
      (
        await request(app)
          .post(`/api/v2/saved-views/${v1.body.id}/set-default`)
          .set(hdr(userB))
          .send({ isDefault: true })
      ).status,
    ).toBe(404);
  });

  it('deletes own view; a second delete / non-owner delete 404s', async () => {
    const created = await request(app)
      .post('/api/v2/saved-views')
      .set(hdr(userA))
      .send({ resourceKey: 'departments', name: 'Doomed', state: {} });
    const id = created.body.id as string;
    expect((await request(app).delete(`/api/v2/saved-views/${id}`).set(hdr(userB))).status).toBe(404);
    expect((await request(app).delete(`/api/v2/saved-views/${id}`).set(hdr(userA))).status).toBe(200);
    expect((await request(app).delete(`/api/v2/saved-views/${id}`).set(hdr(userA))).status).toBe(404);
  });
});
