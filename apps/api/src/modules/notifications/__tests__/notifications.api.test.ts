import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';
import { notificationService } from '../service.js';
import { tokenRepository } from '../token.repository.js';
import { setPusher, type Pusher, type PushResult } from '../../../platform/push/index.js';

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
      // mobile-compat projections (v1 field names) the field app reads:
      message: 'CASE-000001 / RESIDENCE', // = body
      isRead: false, // = readAt != null
      caseId: 'CASE-000001', // surfaced from payload
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

  // ── mobile CRUD parity: trash/restore, mute, preferences, PUT verb aliases ──
  describe('CRUD parity (mobile compat)', () => {
    let user: string;
    const h = (): Record<string, string> => hdr('FIELD_AGENT', user);
    const TASK = '11111111-1111-4111-8111-111111111111';

    beforeAll(async () => {
      user = await createUser('notif_crud');
      await notificationService.notify({ userId: user, type: 'SYSTEM', title: 'one' });
      await notificationService.notify({ userId: user, type: 'SYSTEM', title: 'two' });
    });

    it('accepts the device PUT verb for read + mark-all-read', async () => {
      const list = await request(app).get('/api/v2/notifications').set(h());
      const id = list.body.items[0].id as string;
      const read = await request(app).put(`/api/v2/notifications/${id}/read`).set(h());
      expect(read.status).toBe(200);
      expect(read.body.readAt).not.toBeNull();

      const all = await request(app).put('/api/v2/notifications/mark-all-read').set(h());
      expect(all.status).toBe(200);
      const count = await request(app).get('/api/v2/notifications/unread-count').set(h());
      expect(count.body.count).toBe(0);
    });

    it('soft-deletes one → drops from feed, shows in trash, restores back', async () => {
      const list = await request(app).get('/api/v2/notifications').set(h());
      const before = list.body.totalCount as number;
      const id = list.body.items[0].id as string;

      const del = await request(app).delete(`/api/v2/notifications/${id}`).set(h());
      expect(del.status).toBe(200);
      const after = await request(app).get('/api/v2/notifications').set(h());
      expect(after.body.totalCount).toBe(before - 1);

      const trash = await request(app).get('/api/v2/notifications/trash').set(h());
      expect(trash.body.totalCount).toBe(1);
      expect(trash.body.items[0].id).toBe(id);

      const restore = await request(app).post(`/api/v2/notifications/${id}/restore`).set(h());
      expect(restore.status).toBe(200);
      const back = await request(app).get('/api/v2/notifications').set(h());
      expect(back.body.totalCount).toBe(before);
    });

    it('clear-all trashes everything; bulk restore brings it back', async () => {
      const cleared = await request(app).delete('/api/v2/notifications').set(h());
      expect(cleared.status).toBe(200);
      expect(cleared.body.count).toBeGreaterThanOrEqual(1);
      const empty = await request(app).get('/api/v2/notifications').set(h());
      expect(empty.body.totalCount).toBe(0);

      const restored = await request(app).post('/api/v2/notifications/restore').set(h());
      expect(restored.body.count).toBeGreaterThanOrEqual(1);
      const back = await request(app).get('/api/v2/notifications').set(h());
      expect(back.body.totalCount).toBeGreaterThanOrEqual(1);
    });

    it('mutes a task (UPSERT idempotent), lists it in the v1 envelope, unmutes', async () => {
      const m1 = await request(app).post('/api/v2/notifications/mute').set(h()).send({ taskId: TASK });
      expect(m1.status).toBe(200);
      expect(m1.body.taskId).toBe(TASK);

      const m2 = await request(app)
        .post('/api/v2/notifications/mute')
        .set(h())
        .send({ taskId: TASK, expiresAt: '2099-01-01T00:00:00.000Z' });
      expect(m2.body.id).toBe(m1.body.id); // same row (UPSERT)

      const mutes = await request(app).get('/api/v2/notifications/mutes').set(h());
      expect(mutes.body).toMatchObject({ success: true });
      expect(mutes.body.data).toHaveLength(1);
      expect(mutes.body.data[0].taskId).toBe(TASK);

      const un = await request(app).delete(`/api/v2/notifications/mute/task/${TASK}`).set(h());
      expect(un.status).toBe(200);
      const after = await request(app).get('/api/v2/notifications/mutes').set(h());
      expect(after.body.data).toHaveLength(0);

      const un2 = await request(app).delete(`/api/v2/notifications/mute/task/${TASK}`).set(h());
      expect(un2.status).toBe(404); // no active mute
    });

    it('rejects a mute with a non-uuid taskId (400)', async () => {
      const res = await request(app).post('/api/v2/notifications/mute').set(h()).send({ taskId: 'nope' });
      expect(res.status).toBe(400);
    });

    it('gets default preferences then updates them (own-user)', async () => {
      const get1 = await request(app).get('/api/v2/notifications/preferences').set(h());
      expect(get1.status).toBe(200);
      expect(get1.body.preferences).toEqual({});

      const put = await request(app)
        .put('/api/v2/notifications/preferences')
        .set(h())
        .send({ preferences: { push: false, taskAssigned: true } });
      expect(put.status).toBe(200);
      expect(put.body.preferences).toMatchObject({ push: false, taskAssigned: true });

      const get2 = await request(app).get('/api/v2/notifications/preferences').set(h());
      expect(get2.body.preferences).toMatchObject({ push: false, taskAssigned: true });
    });
  });

  // ── FCM wake-leg + delivery lifecycle (ADR-0027 phase 2) ──
  describe('FCM push + delivery lifecycle', () => {
    let captured: { tokens?: string[]; data?: Record<string, string> };
    function fakePusher(result: PushResult): Pusher {
      return {
        sendDataMessage(tokens, data) {
          captured = { tokens, data };
          return Promise.resolve(result);
        },
        ready: () => true,
      };
    }
    beforeEach(() => {
      captured = {};
    });
    afterAll(() => setPusher(null));

    it('pushes the durable row to the device and stamps DELIVERED', async () => {
      const user = await createUser('notif_push_live');
      await tokenRepository.register({
        userId: user,
        token: 'tok-live-1',
        platform: 'ANDROID',
        deviceId: 'dev-1',
      });
      setPusher(fakePusher({ successCount: 1, failureCount: 0, invalidTokens: [] }));
      const row = await notificationService.notify({
        userId: user,
        type: 'CASE_ASSIGNED',
        title: 'New task assigned',
        body: 'VT-1 · Unit A',
        payload: { caseId: 'c1', caseNumber: 'CASE-1', taskId: 't1', taskNumber: 'VT-1' },
        actionType: 'OPEN_TASK',
      });
      // data is exactly the device's FcmDataSchema key set, all strings, no actionUrl (allowlist fallback)
      expect(captured.tokens).toEqual(['tok-live-1']);
      expect(captured.data).toMatchObject({
        type: 'CASE_ASSIGNED',
        title: 'New task assigned',
        message: 'VT-1 · Unit A',
        taskId: 't1',
        taskNumber: 'VT-1',
        caseId: 'c1',
        caseNumber: 'CASE-1',
        notificationId: row.id,
      });
      expect(captured.data).not.toHaveProperty('actionUrl');
      expect(row.deliveryStatus).toBe('DELIVERED');
      expect(row.sentAt).not.toBeNull();
      expect(row.deliveredAt).not.toBeNull();
    });

    it('stamps SENT (no delivered_at) when the recipient has no device token', async () => {
      const user = await createUser('notif_push_notoken');
      setPusher(fakePusher({ successCount: 0, failureCount: 0, invalidTokens: [] }));
      const row = await notificationService.notify({ userId: user, type: 'SYSTEM', title: 'hi' });
      expect(captured.tokens).toBeUndefined(); // pusher not invoked with zero tokens
      expect(row.deliveryStatus).toBe('SENT');
      expect(row.sentAt).not.toBeNull();
      expect(row.deliveredAt).toBeNull();
    });

    it('prunes a token FCM rejects as invalid (auto-deactivate)', async () => {
      const user = await createUser('notif_push_prune');
      await tokenRepository.register({
        userId: user,
        token: 'tok-dead',
        platform: 'ANDROID',
        deviceId: 'dev-2',
      });
      setPusher(fakePusher({ successCount: 0, failureCount: 1, invalidTokens: ['tok-dead'] }));
      const row = await notificationService.notify({ userId: user, type: 'SYSTEM', title: 'bye' });
      expect(row.deliveryStatus).toBe('SENT'); // no token accepted
      const remaining = await tokenRepository.activeTokensFor(user);
      expect(remaining).not.toContain('tok-dead');
    });
  });
});
