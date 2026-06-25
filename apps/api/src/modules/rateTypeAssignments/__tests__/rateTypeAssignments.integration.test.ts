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
const FA = authHeaderForRole('FIELD_AGENT'); // lacks masterdata.manage → bulk 403

// GET /rate-type-assignments now lists a (client × product|Universal) across all units (no unit param).
const listQ = (clientId: number, productId: number) => `clientId=${clientId}&productId=${productId}`;
// /rate-types/available still resolves a full (client × product × unit) combo.
const combo = (clientId: number, productId: number, unitId: number) =>
  `clientId=${clientId}&productId=${productId}&verificationUnitId=${unitId}`;

// Seed master-data via the API (mirrors commissionRates.api.test.ts) — the migrated clone seeds
// rate_types but no clients/products/verification_units.
const seedId = async (path: string, body: object): Promise<number> => {
  const res = await request(app).post(`/api/v2/${path}`).set(SA).send(body);
  expect(res.status).toBe(201);
  return res.body.id as number;
};

describe.skipIf(!RUN)('rate-type assignments (ADR-0067 Phase B)', () => {
  let clientId: number;
  let productId: number;
  let unitId: number;
  let rtA: number;
  let rtB: number;

  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
    clientId = await seedId('clients', clientFactory({ code: 'RTA_CLIENT' }));
    productId = await seedId('products', productFactory({ code: 'RTA_PRODUCT' }));
    unitId = await seedId('verification-units', verificationUnitFactory({ code: 'RTA_UNIT' }));
    const rts = await db!.pool.query<{ id: number }>(
      `SELECT id FROM rate_types WHERE is_active AND effective_from <= now() ORDER BY sort_order LIMIT 2`,
    );
    rtA = rts.rows[0]!.id;
    rtB = rts.rows[1]!.id;
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate('rate_type_assignments', 'audit_log');
  });

  it('POST /bulk sets two rate types → returns 2 active; GET / returns the same 2', async () => {
    const set = await request(app)
      .post('/api/v2/rate-type-assignments/bulk')
      .set(SA)
      .send({ clientId, productId, verificationUnitId: unitId, rateTypeIds: [rtA, rtB] });
    expect(set.status).toBe(200);
    expect(set.body).toHaveLength(2);
    expect((set.body as { rateTypeId: number }[]).map((r) => r.rateTypeId).sort()).toEqual([rtA, rtB].sort());
    expect(set.body[0]).toMatchObject({ isActive: true });
    expect(set.body[0].rateTypeCode).toBeTypeOf('string');

    const list = await request(app)
      .get(`/api/v2/rate-type-assignments?${listQ(clientId, productId)}`)
      .set(SA);
    expect(list.status).toBe(200);
    expect((list.body as { rateTypeId: number }[]).map((r) => r.rateTypeId).sort()).toEqual(
      [rtA, rtB].sort(),
    );
  });

  it('bulk-set a subset (1) deactivates the dropped one (GET → 1; /available no longer lists it)', async () => {
    await request(app)
      .post('/api/v2/rate-type-assignments/bulk')
      .set(SA)
      .send({ clientId, productId, verificationUnitId: unitId, rateTypeIds: [rtA, rtB] });
    const subset = await request(app)
      .post('/api/v2/rate-type-assignments/bulk')
      .set(SA)
      .send({ clientId, productId, verificationUnitId: unitId, rateTypeIds: [rtA] });
    expect(subset.status).toBe(200);
    expect(subset.body).toHaveLength(1);
    expect(subset.body[0].rateTypeId).toBe(rtA);

    const list = await request(app)
      .get(`/api/v2/rate-type-assignments?${listQ(clientId, productId)}`)
      .set(SA);
    expect((list.body as { rateTypeId: number }[]).map((r) => r.rateTypeId)).toEqual([rtA]);

    // The dropped one is gone from the rate-type availability resolver too.
    const avail = await request(app)
      .get(`/api/v2/rate-types/available?${combo(clientId, productId, unitId)}`)
      .set(SA);
    const availIds = (avail.body as { id: number }[]).map((r) => r.id);
    expect(availIds).toContain(rtA);
    expect(availIds).not.toContain(rtB);
  });

  it('bulk-set [] clears the combo (returns 0)', async () => {
    await request(app)
      .post('/api/v2/rate-type-assignments/bulk')
      .set(SA)
      .send({ clientId, productId, verificationUnitId: unitId, rateTypeIds: [rtA, rtB] });
    const cleared = await request(app)
      .post('/api/v2/rate-type-assignments/bulk')
      .set(SA)
      .send({ clientId, productId, verificationUnitId: unitId, rateTypeIds: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body).toEqual([]);
    const list = await request(app)
      .get(`/api/v2/rate-type-assignments?${listQ(clientId, productId)}`)
      .set(SA);
    expect(list.body).toEqual([]);
  });

  it('a non-existent rateTypeId → 400 INVALID_ASSIGNMENT_REF', async () => {
    const res = await request(app)
      .post('/api/v2/rate-type-assignments/bulk')
      .set(SA)
      .send({ clientId, productId, verificationUnitId: unitId, rateTypeIds: [999999] });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_ASSIGNMENT_REF');
  });

  it('RBAC: a role lacking masterdata.manage cannot POST /bulk (403)', async () => {
    const res = await request(app)
      .post('/api/v2/rate-type-assignments/bulk')
      .set(FA)
      .send({ clientId, productId, verificationUnitId: unitId, rateTypeIds: [rtA] });
    expect(res.status).toBe(403);
  });

  it('GET / with a missing clientId → 400 (clientId is required)', async () => {
    const res = await request(app).get(`/api/v2/rate-type-assignments?productId=${productId}`).set(SA);
    expect(res.status).toBe(400);
  });

  it('GET / with no productId → Universal-product rows (productId omitted = NULL)', async () => {
    // Assign a Universal-product row (productId null) + a specific-product row; GET ?clientId (no
    // productId) returns only the Universal-product set.
    await request(app)
      .post('/api/v2/rate-type-assignments/bulk')
      .set(SA)
      .send({ clientId, productId: null, verificationUnitId: unitId, rateTypeIds: [rtA] });
    await request(app)
      .post('/api/v2/rate-type-assignments/bulk')
      .set(SA)
      .send({ clientId, productId, verificationUnitId: unitId, rateTypeIds: [rtB] });
    const universal = await request(app).get(`/api/v2/rate-type-assignments?clientId=${clientId}`).set(SA);
    expect(universal.status).toBe(200);
    const ids = (universal.body as { rateTypeId: number }[]).map((r) => r.rateTypeId);
    expect(ids).toEqual([rtA]); // the Universal-product row only; the specific-product row is excluded
  });

  it('a Universal row (product+unit NULL) and a specific row for the same client+rateType coexist', async () => {
    // NULLS NOT DISTINCT keys the Universal row as a single value; the specific row is a different key.
    const uni = await request(app)
      .post('/api/v2/rate-type-assignments/bulk')
      .set(SA)
      .send({ clientId, productId: null, verificationUnitId: null, rateTypeIds: [rtA] });
    expect(uni.status).toBe(200);
    expect(uni.body).toHaveLength(1);
    expect(uni.body[0]).toMatchObject({ rateTypeId: rtA, productId: null, verificationUnitId: null });

    const specific = await request(app)
      .post('/api/v2/rate-type-assignments/bulk')
      .set(SA)
      .send({ clientId, productId, verificationUnitId: unitId, rateTypeIds: [rtA] });
    expect(specific.status).toBe(200);
    expect(specific.body).toHaveLength(1);
    expect(specific.body[0]).toMatchObject({ rateTypeId: rtA, productId, verificationUnitId: unitId });

    // Both rows are live: 1 active Universal row + 1 active specific row for the same (client, rtA).
    const rows = await db!.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM rate_type_assignments
        WHERE client_id = $1 AND rate_type_id = $2 AND is_active`,
      [clientId, rtA],
    );
    expect(rows.rows[0]!.n).toBe(2);
  });
});
