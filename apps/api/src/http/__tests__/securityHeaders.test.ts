import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

// MERGED-SECURITY-HEADERS (docs/audit/09-api-security.md, docs/audit/05-xss.md,
// docs/audit/10-frontend-security.md, docs/audit/13-infrastructure.md): every API response must
// carry the standard hardening headers. Uses the DB-free health route so this needs no DATABASE_URL.
describe('security headers', () => {
  const app = createApp({ enableTestAuth: true });

  it('sets nosniff/frame-deny/referrer-policy/CSP on every response', async () => {
    const res = await request(app).get('/api/v2/health');
    expect(res.status).toBe(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
  });

  it('still sets the headers on an error response (401)', async () => {
    const res = await request(app).get('/api/v2/auth/sessions'); // requires auth, no token supplied
    expect(res.status).toBe(401);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
  });
});
