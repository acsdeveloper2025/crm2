import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { ServerTimeSchema } from '@crm2/sdk';
import { createApp } from '../../../http/app.js';

const app = createApp({ enableTestAuth: true });

// Tolerance between the server's reported time and the test process clock (same machine).
const MAX_DRIFT_MS = 5000;

describe('server time (ADR-0028)', () => {
  it('GET /api/v2/time returns a contract-valid serverTime + epochMs, unauthenticated', async () => {
    const res = await request(app).get('/api/v2/time');
    expect(res.status).toBe(200);
    expect(ServerTimeSchema.safeParse(res.body).success).toBe(true);
    expect(Math.abs(res.body.epochMs - Date.now())).toBeLessThan(MAX_DRIFT_MS);
    expect(Date.parse(res.body.serverTime)).toBe(res.body.epochMs);
  });

  it('sets an accurate Date response header (header-only offset fallback)', async () => {
    const res = await request(app).get('/api/v2/time');
    expect(res.headers['date']).toBeTruthy();
    expect(Math.abs(Date.parse(res.headers['date'] as string) - Date.now())).toBeLessThan(MAX_DRIFT_MS);
  });
});
