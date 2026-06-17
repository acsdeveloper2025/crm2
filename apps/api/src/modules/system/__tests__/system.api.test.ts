import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BE = authHeaderForRole('BACKEND_USER');
const COUNT_KEYS = [
  'clients',
  'products',
  'verificationUnits',
  'users',
  'reportTemplates',
  'rates',
  'locations',
];

describe('system API', () => {
  beforeAll(async () => {
    if (RUN) {
      await db!.migrate();
      setPool(db!.pool);
    }
  });
  afterAll(async () => {
    if (RUN) await db!.end();
  });

  it('SUPER_ADMIN gets a health payload (200) with the expected shape', async () => {
    const res = await request(app).get('/api/v2/system/health').set(SA);
    expect(res.status).toBe(200);
    expect(['ok', 'degraded']).toContain(res.body.status);
    expect(typeof res.body.environment).toBe('string');
    expect(typeof res.body.database.connected).toBe('boolean');
    for (const k of COUNT_KEYS) expect(typeof res.body.counts[k]).toBe('number');
    // FCM probe (ADR-0027): pure accessors, no service account in tests → not configured/initialized.
    expect(res.body.push).toMatchObject({ configured: false, initialized: false });
    expect(typeof res.body.push.activeTokens).toBe('number');
  });

  it.skipIf(!RUN)('reports ok + connected + latency when the DB is reachable', async () => {
    const res = await request(app).get('/api/v2/system/health').set(SA);
    expect(res.body.status).toBe('ok');
    expect(res.body.database.connected).toBe(true);
    expect(typeof res.body.database.latencyMs).toBe('number');
    expect(res.body.serverTime).toBeTruthy();
    expect(res.body.counts.users).toBeGreaterThanOrEqual(0);
  });

  it('a non-admin role cannot view system health (403)', async () => {
    expect((await request(app).get('/api/v2/system/health').set(BE)).status).toBe(403);
  });

  it('unauthenticated request is 401', async () => {
    expect((await request(app).get('/api/v2/system/health')).status).toBe(401);
  });
});
