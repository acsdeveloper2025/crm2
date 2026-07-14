import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../http/app.js';
import { setPool } from '../platform/db.js';
import { invalidateRoleCache } from '../platform/access/index.js';

/**
 * Cross-module drift gate (audit 2026-07-14): **an export shares its LIST's audience.**
 *
 * A `/export` returns the same rows as its list, so gating it on the generic `data.export` instead of
 * the list's own permission hands the whole read-model to anyone holding `data.export`. The rule is
 * already documented on `/billing/lines/export` (billing/routes.ts) and tested per-module for the
 * users / roles / policies / departments / designations / field-monitoring families — those work
 * because the seed's BACKEND_USER lacks their list permission.
 *
 * Master data is the one family where NO seeded role reproduces the production shape: the day-0 seed
 * (0033_roles.sql) grants BACKEND_USER and TEAM_LEADER BOTH `page.masterdata` AND `data.export`, while
 * PRODUCTION has had `page.masterdata` stripped from them (ADR-0077 decoupled case-creation from
 * masterdata). So every existing per-module export test uses FIELD_AGENT — which holds NEITHER
 * permission and therefore returns 403 under either gate, giving them ZERO discriminating power. The
 * whole suite stayed green while these 9 routes were gated `data.export`.
 *
 * Hence one bespoke `data.export`-only role (the CASE_CREATOR_NO_MD precedent), asserted against every
 * masterdata export in one table. Re-gate ANY row below back to `DATA_EXPORT` and it flips 403 -> 200.
 */
const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const BE = authHeaderForRole('BACKEND_USER');

/** data.export + case.view, but deliberately NO page.masterdata — production's TEAM_LEADER shape. */
const EXPORTER = { 'x-test-auth': 'EXPORTER_NO_MD:22222222-2222-2222-2222-222222222222' };

/** Every masterdata export. Guard runs before any query parsing, so no seeded rows/params needed. */
const MASTERDATA_EXPORTS = [
  '/api/v2/clients/export',
  '/api/v2/products/export',
  '/api/v2/rates/export',
  '/api/v2/rate-types/export',
  '/api/v2/rate-type-assignments/export',
  '/api/v2/locations/export',
  '/api/v2/verification-units/export',
  '/api/v2/client-products/export',
  '/api/v2/cpv-units/export',
];

describe.skipIf(!RUN)('export gates: an export shares its list audience', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
    await db!.pool.query(
      `INSERT INTO roles (code, name, hierarchy_mode)
       VALUES ('EXPORTER_NO_MD', 'Exporter (no masterdata)', 'SELF')
       ON CONFLICT (code) DO NOTHING`,
    );
    await db!.pool.query(
      `INSERT INTO role_permissions (role_code, permission_code) VALUES
         ('EXPORTER_NO_MD', 'data.export'), ('EXPORTER_NO_MD', 'case.view')
       ON CONFLICT (role_code, permission_code) DO NOTHING`,
    );
    invalidateRoleCache();
  });

  afterAll(async () => {
    await db!.end();
    invalidateRoleCache();
  });

  it.each(MASTERDATA_EXPORTS)('403s a data.export-only role: %s', async (path) => {
    const res = await request(app).get(path).set(EXPORTER);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('FORBIDDEN');
  });

  it('sanity: the same role IS allowed elsewhere — the 403s above are the gate, not a broken actor', async () => {
    // case.view-gated read: proves EXPORTER_NO_MD authenticates and its permissions resolve.
    expect((await request(app).get('/api/v2/cases').set(EXPORTER)).status).toBe(200);
  });

  it.each(MASTERDATA_EXPORTS)('a masterdata viewer keeps its export (not 401/403): %s', async (path) => {
    // Seed BACKEND_USER holds page.masterdata -> the gate must not shut out legitimate viewers.
    // Asserting "not 403" (rather than 200) keeps this independent of each export's own params.
    const res = await request(app).get(`${path}?format=csv&mode=all`).set(BE);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });
});
