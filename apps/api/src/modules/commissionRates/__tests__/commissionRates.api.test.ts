import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createTestDb,
  authHeaderForRole,
  clientFactory,
  productFactory,
  verificationUnitFactory,
} from '@crm2/test-utils';
import type { CommissionRateView } from '@crm2/sdk';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const FA = authHeaderForRole('FIELD_AGENT'); // holds neither masterdata perm
const MGR = authHeaderForRole('MANAGER'); // holds masterdata.view but NOT masterdata.manage
const TL = authHeaderForRole('TEAM_LEADER'); // holds data.export but NOT masterdata.manage

const newUser = async (username: string): Promise<string> => {
  const res = await request(app)
    .post('/api/v2/users')
    .set(SA)
    .send({ username, name: username.toUpperCase(), role: 'FIELD_AGENT' });
  expect(res.status).toBe(201);
  return res.body.id as string;
};

/**
 * ADR-0050: a commission rate is a fully-specified tariff line — every dimension is required. Seed one
 * full set of dimensions (client/product/unit/location) so create payloads can carry them all. `tag`
 * keeps the unique codes distinct across re-seeds within a suite run.
 */
interface Dims {
  clientId: number;
  productId: number;
  verificationUnitId: number;
  locationId: number;
}
const seedId = async (path: string, body: object): Promise<number> => {
  const res = await request(app).post(`/api/v2/${path}`).set(SA).send(body);
  expect(res.status).toBe(201);
  return res.body.id as number;
};
// Unique 6-digit numeric pincode per location seed (pincode regex = ^[1-9][0-9]{5}$).
let pincodeSeq = 400000;
const nextPincode = (): string => String(++pincodeSeq);
const seedDims = async (tag: string): Promise<Dims> => {
  const t = tag.toUpperCase(); // master-data codes must be UPPER_SNAKE
  return {
    clientId: await seedId('clients', clientFactory({ code: `C_${t}` })),
    productId: await seedId('products', productFactory({ code: `P_${t}` })),
    verificationUnitId: await seedId('verification-units', verificationUnitFactory({ code: `U_${t}` })),
    locationId: await seedId('locations', {
      pincode: nextPincode(),
      area: `A_${t}`,
      city: 'Mumbai',
      state: 'MH',
    }),
  };
};
/** A complete create payload (ADR-0050): a fully-specified tariff line for `userId` over `dims`. */
const fullRate = (
  userId: string,
  dims: Dims,
  o: { fieldRateType?: 'LOCAL' | 'OGL'; tatBand?: number; amount: number },
): Record<string, unknown> => ({
  userId,
  clientId: dims.clientId,
  productId: dims.productId,
  verificationUnitId: dims.verificationUnitId,
  locationId: dims.locationId,
  fieldRateType: o.fieldRateType ?? 'LOCAL',
  tatBand: o.tatBand ?? 24,
  amount: o.amount,
});

describe.skipIf(!RUN)('commission-rates API (ADR-0036)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate('commission_rates', 'verification_units', 'products', 'locations', 'clients', 'users');
  });

  it('creates a fully-specified commission rate (201), numeric amount, lists the joined view', async () => {
    const userId = await newUser('cr_u1');
    const dims = await seedDims('u1');
    const created = await request(app)
      .post('/api/v2/commission-rates')
      .set(SA)
      .send(fullRate(userId, dims, { amount: 50 }));
    expect(created.status).toBe(201);
    expect(created.body.amount).toBe(50);
    expect(typeof created.body.amount).toBe('number');
    expect(created.body.currency).toBe('INR');
    expect(created.body.clientId).toBe(dims.clientId);
    expect(created.body.version).toBe(1);

    const list = await request(app).get('/api/v2/commission-rates').set(SA);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].userName).toBe('CR_U1');
    expect(list.body.items[0].clientName).toBeTruthy(); // fully-specified — joined client
    expect(list.body.sort).toEqual({ sortBy: 'user', sortOrder: 'asc' });
  });

  it('rejects an overlapping active rate for the same user+dimensions (409)', async () => {
    const userId = await newUser('cr_dup');
    const dims = await seedDims('dup');
    const first = await request(app)
      .post('/api/v2/commission-rates')
      .set(SA)
      .send(fullRate(userId, dims, { fieldRateType: 'LOCAL', amount: 40 }));
    expect(first.status).toBe(201);
    const dup = await request(app)
      .post('/api/v2/commission-rates')
      .set(SA)
      .send(fullRate(userId, dims, { fieldRateType: 'LOCAL', amount: 60 }));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('COMMISSION_RATE_EXISTS');
    // a DIFFERENT field_rate_type (LOCAL vs OGL) for the same dimensions is allowed (ADR-0050 — a distinct
    // tariff line: LOCAL and OGL can price differently).
    const other = await request(app)
      .post('/api/v2/commission-rates')
      .set(SA)
      .send(fullRate(userId, dims, { fieldRateType: 'OGL', amount: 100 }));
    expect(other.status).toBe(201);
  });

  it('revise end-dates the old row and creates a new version; stale version → 409', async () => {
    const userId = await newUser('cr_rev');
    const dims = await seedDims('rev');
    const created = await request(app)
      .post('/api/v2/commission-rates')
      .set(SA)
      .send(fullRate(userId, dims, { amount: 50 }));
    const id = created.body.id as number;

    const revised = await request(app)
      .post(`/api/v2/commission-rates/${id}/revise`)
      .set(SA)
      .send({ amount: 75, version: 1 });
    expect(revised.status).toBe(200);
    expect(revised.body.amount).toBe(75);
    expect(revised.body.id).not.toBe(id); // a NEW dated row

    // the original is now end-dated → current list shows only the new row
    const current = await request(app).get('/api/v2/commission-rates').set(SA);
    expect(current.body.items).toHaveLength(1);
    expect(current.body.items[0].amount).toBe(75);
    const withHistory = await request(app).get('/api/v2/commission-rates?history=true').set(SA);
    expect(withHistory.body.items.length).toBe(2);

    // revising the now-end-dated original again with a stale version → 409
    const stale = await request(app)
      .post(`/api/v2/commission-rates/${id}/revise`)
      .set(SA)
      .send({ amount: 80, version: 1 });
    expect(stale.status).toBe(409);
  });

  it('deactivate (OCC) removes a rate from the active resolver; reactivation allowed', async () => {
    const userId = await newUser('cr_act');
    const dims = await seedDims('act');
    const created = await request(app)
      .post('/api/v2/commission-rates')
      .set(SA)
      .send(fullRate(userId, dims, { amount: 50 }));
    const id = created.body.id as number;
    const off = await request(app)
      .post(`/api/v2/commission-rates/${id}/deactivate`)
      .set(SA)
      .send({ version: 1 });
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);
    const on = await request(app)
      .post(`/api/v2/commission-rates/${id}/activate`)
      .set(SA)
      .send({ version: 2 });
    expect(on.status).toBe(200);
    expect(on.body.isActive).toBe(true);
  });

  it('both read and write require masterdata.manage (SA-only); a masterdata.view-only role is denied', async () => {
    const userId = await newUser('cr_perm');
    // FIELD_AGENT holds neither perm
    const denied = await request(app)
      .post('/api/v2/commission-rates')
      .set(FA)
      .send({ userId, fieldRateType: 'LOCAL', amount: 50 });
    expect(denied.status).toBe(403);
    expect((await request(app).get('/api/v2/commission-rates').set(FA)).status).toBe(403);
    // MANAGER holds masterdata.VIEW but NOT masterdata.manage → commission amounts are hidden (read 403)
    expect((await request(app).get('/api/v2/commission-rates').set(MGR)).status).toBe(403);
  });

  it('validates input: bad userId → 400', async () => {
    const bad = await request(app)
      .post('/api/v2/commission-rates')
      .set(SA)
      .send({ userId: 'not-a-uuid', fieldRateType: 'LOCAL', amount: 50 });
    expect(bad.status).toBe(400);
  });

  describe('import / export', () => {
    // ADR-0050: every dimension is a required tariff key, so the import file now carries the full set —
    // Rate Type (LOCAL/OGL), Client Code, Location (Pincode + Area), Product Code, Unit Code, TAT Band.
    const HEADER = [
      'Username',
      'Rate Type',
      'Client Code',
      'Location Pincode',
      'Area',
      'Product Code',
      'Unit Code',
      'TAT Band',
      'Amount',
    ];
    const mkXlsx = async (rows: (string | number)[][]): Promise<Buffer> => {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Sheet1');
      ws.addRow(HEADER);
      for (const r of rows) ws.addRow(r);
      return Buffer.from(await wb.xlsx.writeBuffer());
    };
    const upload = (mode: 'preview' | 'confirm', buf: Buffer, auth = SA) =>
      request(app)
        .post(`/api/v2/commission-rates/import?mode=${mode}`)
        .set(auth)
        .set('content-type', 'application/octet-stream')
        .set('x-filename', 'commission-rates.xlsx')
        .send(buf);

    // Seed the FK dimensions the import rows reference (codes/pincode resolve to ids). Each row below
    // uses these known codes; the row builder fills every required column.
    let impDims: { clientCode: string; pincode: string; area: string; productCode: string; unitCode: string };
    beforeEach(async () => {
      const tag = 'IMP';
      await seedId('clients', clientFactory({ code: `C_${tag}` }));
      await seedId('products', productFactory({ code: `P_${tag}` }));
      await seedId('verification-units', verificationUnitFactory({ code: `U_${tag}` }));
      await seedId('locations', { pincode: '400099', area: `A_${tag}`, city: 'Mumbai', state: 'MH' });
      impDims = {
        clientCode: `C_${tag}`,
        pincode: '400099',
        area: `A_${tag}`,
        productCode: `P_${tag}`,
        unitCode: `U_${tag}`,
      };
    });
    /** A fully-specified import row matching HEADER's column order. */
    const row = (username: string, fieldRateType: string, amount: number): (string | number)[] => [
      username,
      fieldRateType,
      impDims.clientCode,
      impDims.pincode,
      impDims.area,
      impDims.productCode,
      impDims.unitCode,
      24,
      amount,
    ];

    it('downloads an XLSX template (200 + PK body); template gated masterdata.manage', async () => {
      const res = await request(app)
        .get('/api/v2/commission-rates/import-template')
        .set(SA)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect((res.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
      expect((await request(app).get('/api/v2/commission-rates/import-template').set(MGR)).status).toBe(403);
    });

    it('preview resolves a known username (valid) and flags an unknown one (errorRows)', async () => {
      await newUser('imp_user');
      const res = await upload(
        'preview',
        await mkXlsx([row('imp_user', 'LOCAL', 70), row('nope_user', 'LOCAL', 80)]),
      );
      expect(res.status).toBe(200);
      expect(res.body.validRows).toBe(1);
      expect(res.body.errorRows).toBe(1);
      expect(res.body.errors[0]).toMatchObject({ column: 'Username' });
      // preview is read-only — nothing written
      expect((await request(app).get('/api/v2/commission-rates').set(SA)).body.totalCount).toBe(0);
    });

    it('confirm imports the valid row and grows the list', async () => {
      await newUser('imp_user2');
      const res = await upload('confirm', await mkXlsx([row('imp_user2', 'OGL', 90)]));
      expect(res.status).toBe(200);
      expect(res.body.successRows).toBe(1);
      const list = await request(app).get('/api/v2/commission-rates').set(SA);
      expect(list.body.totalCount).toBe(1);
      expect(list.body.items[0]).toMatchObject({ fieldRateType: 'OGL', amount: 90 });
      expect(list.body.items[0].clientId).toBeTruthy(); // fully-specified — resolved client dimension
    });

    it('export carries comp data → gated masterdata.manage (SA ok), NOT data.export (TEAM_LEADER 403)', async () => {
      const userId = await newUser('exp_user');
      const dims = await seedDims('exp');
      await request(app)
        .post('/api/v2/commission-rates')
        .set(SA)
        .send(fullRate(userId, dims, { amount: 50 }));
      expect(
        (await request(app).get('/api/v2/commission-rates/export?format=csv&mode=all').set(SA)).status,
      ).toBe(200);
      // TEAM_LEADER holds data.export but NOT masterdata.manage → must be 403 (no comp-data exfil)
      expect(
        (await request(app).get('/api/v2/commission-rates/export?format=csv&mode=all').set(TL)).status,
      ).toBe(403);
    });
  });
  /**
   * Dimension CRUD + list view (ADR-0046 §1 D-c, §6, §7.1): create carries the new
   * location/product/VU/tat_band dimensions; the list view returns their display fields; the no-overlap
   * EXCLUDE keys on the full dimension tuple. Nested so it shares the outer migrate/end lifecycle (one
   * shared `db`); its own `beforeEach` truncates the extra dimension tables + seeds them.
   */
  describe('dimensions (ADR-0050)', () => {
    let dimUserId: string;
    let clientId: number;
    let locId: number;
    let loc2Id: number;
    let prodId: number;
    let vuId: number;

    beforeEach(async () => {
      await db!.truncate(
        'commission_rates',
        'verification_units',
        'products',
        'locations',
        'clients',
        'users',
      );
      dimUserId = await newUser('cr_dim');
      clientId = await seedId('clients', clientFactory({ code: 'C_DIM' }));
      locId = await seedId('locations', { pincode: '411001', area: 'DIMAREA', city: 'Pune', state: 'MH' });
      loc2Id = await seedId('locations', { pincode: '411002', area: 'DIM2AREA', city: 'Pune', state: 'MH' });
      prodId = await seedId('products', productFactory({ code: 'P_DIM' }));
      vuId = await seedId('verification-units', verificationUnitFactory({ code: 'VU_DIM' }));
    });

    it('create accepts the full dimension set and the list view returns them', async () => {
      const res = await request(app).post('/api/v2/commission-rates').set(SA).send({
        userId: dimUserId,
        clientId,
        locationId: locId,
        productId: prodId,
        verificationUnitId: vuId,
        fieldRateType: 'LOCAL',
        tatBand: 24,
        amount: 70,
      });
      expect(res.status).toBe(201);
      expect(res.body.clientId).toBe(clientId);
      expect(res.body.locationId).toBe(locId);
      expect(res.body.productId).toBe(prodId);
      expect(res.body.verificationUnitId).toBe(vuId);
      expect(res.body.tatBand).toBe(24);

      const list = await request(app).get(`/api/v2/commission-rates?userId=${dimUserId}`).set(SA);
      expect(list.status).toBe(200);
      const row = (list.body.items as CommissionRateView[]).find((r) => r.amount === 70)!;
      expect(row.locationId).toBe(locId);
      expect(row.productId).toBe(prodId);
      expect(row.verificationUnitId).toBe(vuId);
      expect(row.tatBand).toBe(24);
      // display fields from the joins
      expect(row.pincode).toBe('411001');
      expect(row.area).toBe('DIMAREA');
      expect(row.productCode).toBe('P_DIM');
      expect(row.productName).toBeTruthy();
      expect(row.verificationUnitName).toBeTruthy();
    });

    it('no-overlap holds on the new dimension tuple (two identical-dim active rows → 409)', async () => {
      const body = {
        userId: dimUserId,
        clientId,
        locationId: locId,
        productId: prodId,
        verificationUnitId: vuId,
        fieldRateType: 'LOCAL',
        tatBand: 24,
        amount: 5,
      };
      const first = await request(app).post('/api/v2/commission-rates').set(SA).send(body);
      expect(first.status).toBe(201);
      const dup = await request(app).post('/api/v2/commission-rates').set(SA).send(body);
      expect(dup.status).toBe(409);
      expect(dup.body.error).toBe('COMMISSION_RATE_EXISTS');
      // a DIFFERENT location for the same user is allowed (new tuple ⇒ no overlap)
      const other = await request(app)
        .post('/api/v2/commission-rates')
        .set(SA)
        .send({ ...body, locationId: loc2Id });
      expect(other.status).toBe(201);
    });
  });
});
