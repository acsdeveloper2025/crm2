import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createTestDb,
  clientFactory,
  productFactory,
  verificationUnitFactory,
  authHeaderForRole,
} from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

/**
 * ADR-0074 — Universal CPV. A client+product can map a single verification unit OR "Universal (all units)"
 * (verification_unit_id NULL = all units, mirroring rates). When a Universal CPV exists, the available-units
 * resolver returns EVERY active unit (else only the specifically-mapped ones). NULLS NOT DISTINCT dedupes
 * the Universal row.
 */
const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const FA = authHeaderForRole('FIELD_AGENT');

const newClient = async (code: string) =>
  (await request(app).post('/api/v2/clients').set(SA).send(clientFactory({ code }))).body.id as number;
const newProduct = async (code: string) =>
  (await request(app).post('/api/v2/products').set(SA).send(productFactory({ code }))).body.id as number;
const newUnit = async (code: string) =>
  (await request(app).post('/api/v2/verification-units').set(SA).send(verificationUnitFactory({ code }))).body
    .id as number;
const newCp = async (clientId: number, productId: number) =>
  (await request(app).post('/api/v2/client-products').set(SA).send({ clientId, productId })).body
    .id as number;
const mapUnit = (clientProductId: number, verificationUnitId?: number) =>
  request(app)
    .post('/api/v2/cpv-units')
    .set(SA)
    .send(verificationUnitId === undefined ? { clientProductId } : { clientProductId, verificationUnitId });
const available = (clientId: number, productId: number, hdr = SA) =>
  request(app).get(`/api/v2/cpv-units/available?clientId=${clientId}&productId=${productId}`).set(hdr);

describe.skipIf(!RUN)('CPV Universal (all units) — ADR-0074', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate(
      'clients',
      'products',
      'verification_units',
      'client_products',
      'client_product_verification_units',
      'audit_log',
      'import_log',
    );
  });

  it('maps a Universal CPV (verificationUnitId omitted → null) and lists it with a null unit', async () => {
    const cpId = await newCp(await newClient('C_U1'), await newProduct('P_U1'));
    const res = await mapUnit(cpId);
    expect(res.status).toBe(201);
    expect(res.body.verificationUnitId).toBeNull();
    const list = await request(app).get(`/api/v2/cpv-units?clientProductId=${cpId}`).set(SA);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].verificationUnitId).toBeNull();
    expect(list.body[0].unitName).toBeNull(); // LEFT JOIN keeps the row; the UI renders "Universal"
  });

  it('a second Universal CPV for the same client-product → 409 (NULLS NOT DISTINCT)', async () => {
    const cpId = await newCp(await newClient('C_U2'), await newProduct('P_U2'));
    expect((await mapUnit(cpId)).status).toBe(201);
    const dup = await mapUnit(cpId);
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('CPV_UNIT_EXISTS');
  });

  it('a Universal CPV and a specific-unit CPV coexist', async () => {
    const cpId = await newCp(await newClient('C_U3'), await newProduct('P_U3'));
    expect((await mapUnit(cpId)).status).toBe(201); // Universal
    expect((await mapUnit(cpId, await newUnit('U_U3'))).status).toBe(201); // specific
  });

  it('available-units: only mapped units normally, ALL active units once a Universal CPV exists', async () => {
    const clientId = await newClient('C_AV');
    const productId = await newProduct('P_AV');
    const cpId = await newCp(clientId, productId);
    const u1 = await newUnit('U_AV1');
    const u2 = await newUnit('U_AV2'); // never specifically mapped
    await mapUnit(cpId, u1);
    const before = await available(clientId, productId);
    expect(before.status).toBe(200);
    expect(before.body.map((u: { id: number }) => u.id)).toEqual([u1]);

    await mapUnit(cpId); // add Universal
    const after = await available(clientId, productId);
    const ids = after.body.map((u: { id: number }) => u.id);
    expect(ids).toContain(u1);
    expect(ids).toContain(u2); // Universal ⇒ even the never-mapped unit is available
  });

  it('GET /cpv-units/available is permission-gated (FIELD_AGENT 403; unauthenticated 401)', async () => {
    const clientId = await newClient('C_PG');
    const productId = await newProduct('P_PG');
    await newCp(clientId, productId);
    expect((await available(clientId, productId, FA)).status).toBe(403);
    expect(
      (await request(app).get(`/api/v2/cpv-units/available?clientId=${clientId}&productId=${productId}`))
        .status,
    ).toBe(401);
  });
});
