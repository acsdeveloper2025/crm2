import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });

// IST 06:30 (outside the 8–22 shift) vs IST 15:30 (inside).
const TS_OUTSIDE = '2026-06-11T01:00:00.000Z';
const TS_INSIDE = '2026-06-11T10:00:00.000Z';

async function createAgent(): Promise<string> {
  const res = await request(app)
    .post('/api/v2/users')
    .set(SA)
    .send({ username: 'loc_agent', name: 'Loc Agent', role: 'FIELD_AGENT' });
  expect(res.status).toBe(201);
  return res.body.id as string;
}

describe.skipIf(!RUN)('device location capture (ADR-0026, locked contract)', () => {
  let agentId: string;
  const agentHdr = (): Record<string, string> => hdr('FIELD_AGENT', agentId);

  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
    agentId = await createAgent();
  });
  afterAll(async () => {
    await db!.end();
  });

  it('captures a TRACKING fix inside the shift window + upserts the projection', async () => {
    const res = await request(app)
      .post('/api/v2/location/capture')
      .set(agentHdr())
      .send({ latitude: 19.07, longitude: 72.87, accuracy: 8, timestamp: TS_INSIDE, source: 'TRACKING' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ accuracy: 8 });
    expect(res.body).not.toHaveProperty('success');
    expect(typeof res.body.id).toBe('string');
    const { rows } = await db!.pool.query(`SELECT * FROM latest_device_location WHERE user_id = $1`, [
      agentId,
    ]);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].latitude)).toBeCloseTo(19.07, 2);
  });

  it('rejects a TRACKING fix outside the shift window with 403 OUTSIDE_SHIFT_WINDOW', async () => {
    const res = await request(app)
      .post('/api/v2/location/capture')
      .set(agentHdr())
      .send({ latitude: 19.07, longitude: 72.87, timestamp: TS_OUTSIDE, source: 'TRACKING' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('OUTSIDE_SHIFT_WINDOW');
  });

  it('rejects a future-skewed timestamp (fast device clock) with 400 CLOCK_SKEW_AHEAD', async () => {
    const TEN_MIN_MS = 600_000;
    const future = new Date(Date.now() + TEN_MIN_MS).toISOString();
    const res = await request(app)
      .post('/api/v2/location/capture')
      .set(agentHdr())
      .send({ latitude: 19.07, longitude: 72.87, timestamp: future, source: 'TRACKING' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('CLOCK_SKEW_AHEAD');
  });

  it('still accepts an OLD timestamp (offline queue replay is never future-skewed)', async () => {
    const THIRTY_DAYS_MS = 2_592_000_000;
    // An old fix that also happens to fall inside the IST shift window (15:30 IST).
    const old = new Date(Date.now() - THIRTY_DAYS_MS);
    old.setUTCHours(10, 0, 0, 0);
    const res = await request(app)
      .post('/api/v2/location/capture')
      .set(agentHdr())
      .send({ latitude: 19.07, longitude: 72.87, timestamp: old.toISOString(), source: 'ADMIN_PING' });
    expect(res.status).toBe(200);
  });

  it('ADMIN_PING bypasses the shift window (admin can locate anytime)', async () => {
    const res = await request(app).post('/api/v2/location/capture').set(agentHdr()).send({
      latitude: 19.1,
      longitude: 72.9,
      timestamp: TS_OUTSIDE,
      source: 'ADMIN_PING',
      requestedBy: 'admin-x',
    });
    expect(res.status).toBe(200);
  });

  it('captures a GPS verification fix — the widened source domain (0072), not a CHECK 500', async () => {
    const res = await request(app)
      .post('/api/v2/location/capture')
      .set(agentHdr())
      .send({ latitude: 19.05, longitude: 72.85, accuracy: 6, timestamp: TS_INSIDE, source: 'GPS' });
    expect(res.status).toBe(200);
    expect(typeof res.body.id).toBe('string');
    const { rows } = await db!.pool.query(
      `SELECT count(*)::int AS n FROM device_locations WHERE user_id = $1 AND source = 'GPS'`,
      [agentId],
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(1); // GPS row persisted (the 0043 CHECK would have 500'd it)
  });

  it('is idempotent on the Idempotency-Key (FCM+socket double-delivery → one row)', async () => {
    const body = { latitude: 19.2, longitude: 72.8, timestamp: TS_INSIDE, source: 'ADMIN_PING' };
    const first = await request(app)
      .post('/api/v2/location/capture')
      .set(agentHdr())
      .set('Idempotency-Key', 'op-123')
      .send(body);
    const second = await request(app)
      .post('/api/v2/location/capture')
      .set(agentHdr())
      .set('Idempotency-Key', 'op-123')
      .send(body);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    const { rows } = await db!.pool.query(
      `SELECT count(*)::int AS n FROM device_locations WHERE operation_id = $1`,
      ['op-123'],
    );
    expect(rows[0].n).toBe(1);
  });

  it('RBAC: a role without location.capture is forbidden', async () => {
    const res = await request(app)
      .post('/api/v2/location/capture')
      .set(authHeaderForRole('KYC_VERIFIER'))
      .send({ latitude: 19.07, longitude: 72.87, timestamp: TS_INSIDE, source: 'TRACKING' });
    expect(res.status).toBe(403);
  });

  it('rejects a malformed body (400)', async () => {
    const res = await request(app)
      .post('/api/v2/location/capture')
      .set(agentHdr())
      .send({ latitude: 999, longitude: 72.87, timestamp: TS_INSIDE, source: 'TRACKING' });
    expect(res.status).toBe(400);
  });
});
