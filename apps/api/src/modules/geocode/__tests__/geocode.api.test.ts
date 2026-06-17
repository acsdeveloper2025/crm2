import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';
import { setGeocoder } from '../../../platform/geocode/index.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');

describe.skipIf(!RUN)('reverse geocode (ADR-0026)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    setGeocoder(null);
    await db!.end();
  });
  afterEach(() => setGeocoder(null));

  it('resolves an address, freezes it in the cache, and serves the cache on the second call', async () => {
    let calls = 0;
    setGeocoder({
      reverse: () => {
        calls += 1;
        return Promise.resolve('12 MG Road, Mumbai 400001, India');
      },
    });
    const first = await request(app).get('/api/v2/geocode/reverse?lat=19.076033&lng=72.877721').set(SA);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ address: '12 MG Road, Mumbai 400001, India', cached: false });

    const second = await request(app).get('/api/v2/geocode/reverse?lat=19.076033&lng=72.877721').set(SA);
    expect(second.body).toEqual({ address: '12 MG Road, Mumbai 400001, India', cached: true });
    expect(calls).toBe(1); // second served from the frozen cache — Google not called again
  });

  it('returns address:null when the geocoder is unconfigured (degrades to coords, not an error)', async () => {
    setGeocoder({ reverse: () => Promise.resolve(null) });
    const res = await request(app).get('/api/v2/geocode/reverse?lat=10.5&lng=20.5').set(SA);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ address: null, cached: false });
  });

  it('rejects invalid coordinates (400)', async () => {
    expect((await request(app).get('/api/v2/geocode/reverse?lat=999&lng=0').set(SA)).status).toBe(400);
    expect((await request(app).get('/api/v2/geocode/reverse?lat=foo&lng=bar').set(SA)).status).toBe(400);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/v2/geocode/reverse?lat=19&lng=72')).status).toBe(401);
  });
});
