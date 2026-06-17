import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';
import { notificationService } from '../service.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });

async function createUser(username: string): Promise<string> {
  const res = await request(app)
    .post('/api/v2/users')
    .set(SA)
    .send({ username, name: username, role: 'FIELD_AGENT' });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe.skipIf(!RUN)('notifications feed (ADR-0027)', () => {
  let userA: string;
  let userB: string;
  const aHdr = (): Record<string, string> => hdr('FIELD_AGENT', userA);
  const bHdr = (): Record<string, string> => hdr('FIELD_AGENT', userB);

  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
    userA = await createUser('notif_a');
    userB = await createUser('notif_b');
    await notificationService.notify({
      userId: userA,
      type: 'CASE_TASK_ASSIGNED',
      title: 'Task assigned',
      body: 'CASE-000001 / RESIDENCE',
      payload: { caseId: 'CASE-000001' },
      actionType: 'OPEN_TASK',
    });
    await notificationService.notify({
      userId: userA,
      type: 'SYSTEM',
      title: 'Welcome',
    });
  });
  afterAll(async () => {
    await db!.end();
  });

  it('returns the own feed newest-first in the paginated envelope', async () => {
    const res = await request(app).get('/api/v2/notifications').set(aHdr());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ totalCount: 2, page: 1 });
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items[0].title).toBe('Welcome'); // newest first
    expect(res.body.items[1]).toMatchObject({
      type: 'CASE_TASK_ASSIGNED',
      actionType: 'OPEN_TASK',
      readAt: null,
      payload: { caseId: 'CASE-000001' },
    });
  });

  it('reports the unread count', async () => {
    const res = await request(app).get('/api/v2/notifications/unread-count').set(aHdr());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ count: 2 });
  });

  it('marks one notification read (idempotent) and drops the unread count', async () => {
    const list = await request(app).get('/api/v2/notifications').set(aHdr());
    const id = list.body.items[0].id as string;

    const read1 = await request(app).post(`/api/v2/notifications/${id}/read`).set(aHdr());
    expect(read1.status).toBe(200);
    expect(read1.body.readAt).not.toBeNull();
    const firstReadAt = read1.body.readAt as string;

    // idempotent: re-reading preserves the original read_at
    const read2 = await request(app).post(`/api/v2/notifications/${id}/read`).set(aHdr());
    expect(read2.body.readAt).toBe(firstReadAt);

    const count = await request(app).get('/api/v2/notifications/unread-count').set(aHdr());
    expect(count.body.count).toBe(1);
  });

  it('marks all read', async () => {
    const res = await request(app).post('/api/v2/notifications/mark-all-read').set(aHdr());
    expect(res.status).toBe(200);
    expect(res.body.updated).toBe(1); // one still-unread remained
    const count = await request(app).get('/api/v2/notifications/unread-count').set(aHdr());
    expect(count.body.count).toBe(0);
    const unread = await request(app).get('/api/v2/notifications?unreadOnly=true').set(aHdr());
    expect(unread.body.totalCount).toBe(0);
  });

  it('is own-user scoped — another user sees nothing and cannot read A’s row', async () => {
    const aList = await request(app).get('/api/v2/notifications').set(aHdr());
    const aId = aList.body.items[0].id as string;

    const bList = await request(app).get('/api/v2/notifications').set(bHdr());
    expect(bList.body.totalCount).toBe(0);

    const bRead = await request(app).post(`/api/v2/notifications/${aId}/read`).set(bHdr());
    expect(bRead.status).toBe(404);
  });

  it('rejects a malformed id with 404 (no pg 22P02 → 500)', async () => {
    const res = await request(app).post('/api/v2/notifications/not-a-uuid/read').set(aHdr());
    expect(res.status).toBe(404);
  });

  it('401s an unauthenticated request', async () => {
    const res = await request(app).get('/api/v2/notifications');
    expect(res.status).toBe(401);
  });
});
