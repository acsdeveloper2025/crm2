import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createTestDb,
  authHeaderForRole,
  clientFactory,
  productFactory,
  verificationUnitFactory,
} from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const FA = authHeaderForRole('FIELD_AGENT');
const MGR = authHeaderForRole('MANAGER'); // has case.create (not page.masterdata-only) — `available` reader
const KYC = authHeaderForRole('KYC_VERIFIER'); // has neither page.masterdata nor case.create → 403

describe.skipIf(!RUN)('rate-types CRUD (ADR-0064)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    // Keep the seeded catalog (mig 0014 + 0091 OFFICE) intact — only the audit trail is reset.
    await db!.truncate('audit_log');
  });

  it('GET /api/v2/rate-types returns the seeded catalog paginated (incl OFFICE)', async () => {
    const res = await request(app).get('/api/v2/rate-types?limit=50').set(SA);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeGreaterThanOrEqual(19); // 18 (mig 0014) + OFFICE (mig 0091)
    expect(res.body.items.some((r: { code: string }) => r.code === 'OFFICE')).toBe(true);
    expect(res.body.totalCount).toBeGreaterThanOrEqual(19);
  });

  it('POST creates a rate type (uppercased code), defaults category FIELD, then GET /:id returns it', async () => {
    const res = await request(app)
      .post('/api/v2/rate-types')
      .set(SA)
      .send({ code: 'zztest', name: 'zz test' });
    expect(res.status).toBe(201);
    expect(res.body.code).toBe('ZZTEST');
    expect(res.body.category).toBe('FIELD');
    expect(res.body.version).toBe(1);
    const get = await request(app).get(`/api/v2/rate-types/${res.body.id}`).set(SA);
    expect(get.status).toBe(200);
    expect(get.body.code).toBe('ZZTEST');
  });

  it('POST a duplicate code → 409 RATE_TYPE_EXISTS', async () => {
    const res = await request(app).post('/api/v2/rate-types').set(SA).send({ code: 'LOCAL', name: 'dup' });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('RATE_TYPE_EXISTS');
  });

  it('PUT updates name/category but NOT code; stale version → 409', async () => {
    const created = (await request(app).post('/api/v2/rate-types').set(SA).send({ code: 'zzupd', name: 'a' }))
      .body;
    const ok = await request(app)
      .put(`/api/v2/rate-types/${created.id}`)
      .set(SA)
      .send({ name: 'b', category: 'OFFICE', code: 'HACK', version: created.version });
    expect(ok.status).toBe(200);
    expect(ok.body.name).toBe('B');
    expect(ok.body.category).toBe('OFFICE');
    expect(ok.body.code).toBe('ZZUPD'); // code ignored — immutable
    expect(ok.body.version).toBe(2);
    const stale = await request(app)
      .put(`/api/v2/rate-types/${created.id}`)
      .set(SA)
      .send({ name: 'c', category: 'FIELD', version: created.version });
    expect(stale.status).toBe(409);
  });

  it('deactivate/activate are version-guarded', async () => {
    const c = (await request(app).post('/api/v2/rate-types').set(SA).send({ code: 'zzact', name: 'x' })).body;
    const d = await request(app)
      .post(`/api/v2/rate-types/${c.id}/deactivate`)
      .set(SA)
      .send({ version: c.version });
    expect(d.status).toBe(200);
    expect(d.body.isActive).toBe(false);
    const a = await request(app)
      .post(`/api/v2/rate-types/${c.id}/activate`)
      .set(SA)
      .send({ version: d.body.version });
    expect(a.status).toBe(200);
    expect(a.body.isActive).toBe(true);
  });

  it('GET /options returns the lean usable shape (id/code/category)', async () => {
    const res = await request(app).get('/api/v2/rate-types/options?active=true').set(SA);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    const office = res.body.find((o: { code: string }) => o.code === 'OFFICE');
    expect(office).toMatchObject({ code: 'OFFICE', category: 'OFFICE' });
    expect(office.id).toBeTypeOf('number');
  });

  it('RBAC: a non-masterdata role cannot write (403)', async () => {
    const res = await request(app).post('/api/v2/rate-types').set(FA).send({ code: 'zzno', name: 'no' });
    expect(res.status).toBe(403);
  });

  // GET /api/v2/rate-types/available — ADR-0067 Phase B combo resolver.
  describe('GET /available (combo resolver)', () => {
    let clientId: number;
    let productId: number;
    let unitId: number;
    let activeRt: number; // assigned + active → appears
    let otherRt: number; // active rate type, NOT assigned → absent
    let inactiveRt: number; // assigned but its assignment is inactive → absent

    beforeAll(async () => {
      // Seed master-data via the API (the migrated clone has no clients/products/units).
      const seedId = async (path: string, body: object): Promise<number> => {
        const res = await request(app).post(`/api/v2/${path}`).set(SA).send(body);
        expect(res.status).toBe(201);
        return res.body.id as number;
      };
      clientId = await seedId('clients', clientFactory({ code: 'RT_AVAIL_CLIENT' }));
      productId = await seedId('products', productFactory({ code: 'RT_AVAIL_PRODUCT' }));
      unitId = await seedId('verification-units', verificationUnitFactory({ code: 'RT_AVAIL_UNIT' }));
      const rts = await db!.pool.query<{ id: number }>(
        `SELECT id FROM rate_types WHERE is_active AND effective_from <= now() ORDER BY sort_order LIMIT 3`,
      );
      activeRt = rts.rows[0]!.id;
      otherRt = rts.rows[1]!.id;
      inactiveRt = rts.rows[2]!.id;
      // One active assignment (should appear) + one inactive assignment (should NOT appear).
      await db!.pool.query(
        `INSERT INTO rate_type_assignments (client_id, product_id, verification_unit_id, rate_type_id, is_active)
         VALUES ($1,$2,$3,$4,true), ($1,$2,$3,$5,false)`,
        [clientId, productId, unitId, activeRt, inactiveRt],
      );
    });

    it('returns the active assignments for the combo (and excludes inactive / unassigned)', async () => {
      const res = await request(app)
        .get(
          `/api/v2/rate-types/available?clientId=${clientId}&productId=${productId}&verificationUnitId=${unitId}`,
        )
        .set(SA);
      expect(res.status).toBe(200);
      const ids = (res.body as { id: number }[]).map((r) => r.id);
      expect(ids).toContain(activeRt);
      expect(ids).not.toContain(inactiveRt);
      expect(ids).not.toContain(otherRt);
      expect(res.body[0]).toMatchObject({ id: activeRt });
      expect(res.body[0].code).toBeTypeOf('string');
    });

    it('a combo with no assignments returns []', async () => {
      const res = await request(app)
        .get(
          `/api/v2/rate-types/available?clientId=${clientId}&productId=${productId}&verificationUnitId=999999`,
        )
        .set(SA);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('a missing query param → 400', async () => {
      const res = await request(app)
        .get(`/api/v2/rate-types/available?clientId=${clientId}&productId=${productId}`)
        .set(SA);
      expect(res.status).toBe(400);
    });

    it('RBAC: a case.create role (no page.masterdata) gets 200', async () => {
      const res = await request(app)
        .get(
          `/api/v2/rate-types/available?clientId=${clientId}&productId=${productId}&verificationUnitId=${unitId}`,
        )
        .set(MGR);
      expect(res.status).toBe(200);
    });

    it('RBAC: a role with neither page.masterdata nor case.create gets 403', async () => {
      const res = await request(app)
        .get(
          `/api/v2/rate-types/available?clientId=${clientId}&productId=${productId}&verificationUnitId=${unitId}`,
        )
        .set(KYC);
      expect(res.status).toBe(403);
    });
  });
});
