import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import { __resetEnv } from '@crm2/config';
import { loginLimiter } from '../rateLimit.js';

/**
 * Verifies the limiter trips with the canonical 429 shape (ADR-0076). Runs with a tiny per-IP limit
 * forced via env; the real suite uses a high ceiling (vitest.config.ts) so its own logins never trip.
 */
describe('rate limiter (ADR-0076)', () => {
  const saved: Record<string, string | undefined> = {};
  const set = (k: string, v: string): void => {
    saved[k] = process.env[k];
    process.env[k] = v;
  };

  beforeAll(() => {
    if (!process.env['DATABASE_URL']) set('DATABASE_URL', 'postgres://x'); // limiter never queries
    set('RATE_LIMIT_LOGIN_MAX', '2');
    set('RATE_LIMIT_LOGIN_WINDOW_MS', '60000');
    __resetEnv();
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    __resetEnv();
  });

  it('returns 429 TOO_MANY_REQUESTS after the per-IP limit', async () => {
    const app = express();
    app.set('trust proxy', 1);
    app.post('/login', loginLimiter(), (_req, res) => res.json({ ok: true }));

    await request(app).post('/login').expect(200);
    await request(app).post('/login').expect(200);
    const res = await request(app).post('/login');

    expect(res.status).toBe(429);
    expect(res.body).toEqual({ error: 'TOO_MANY_REQUESTS' });
  });
});
