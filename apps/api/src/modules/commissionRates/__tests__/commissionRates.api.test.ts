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
    .send({
      email: `${username}@test.crm2.local`,
      username,
      name: username.toUpperCase(),
      role: 'FIELD_AGENT',
    });
  expect(res.status).toBe(201);
  return res.body.id as string;
};

/** Create a user with an explicit (non-field) role — for the bulk field-agent-only guard test. */
const newUserRole = async (username: string, role: string): Promise<string> => {
  const res = await request(app)
    .post('/api/v2/users')
    .set(SA)
    .send({ email: `${username}@test.crm2.local`, username, name: username.toUpperCase(), role });
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
    // Owner rule (2026-07-11): one (user, location) holds ONE rate type — a DIFFERENT type at the
    // same location is rejected (409), not added as a second tariff line. (Supersedes the earlier
    // different-type-allowed behavior at the CREATE boundary; payout resolution is unchanged.)
    const other = await request(app)
      .post('/api/v2/commission-rates')
      .set(SA)
      .send(fullRate(userId, dims, { fieldRateType: 'OGL', amount: 100 }));
    expect(other.status).toBe(409);
    expect(other.body.error).toBe('HAS_OTHER_RATE_TYPE');
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

  describe('GET /:id (record-page loader)', () => {
    it('returns the joined view for a created rate (200)', async () => {
      const userId = await newUser('cr_get');
      const dims = await seedDims('get');
      const created = await request(app)
        .post('/api/v2/commission-rates')
        .set(SA)
        .send(fullRate(userId, dims, { amount: 55 }));
      expect(created.status).toBe(201);
      const id = created.body.id as number;

      const res = await request(app).get(`/api/v2/commission-rates/${id}`).set(SA);
      expect(res.status).toBe(200);
      const rate = res.body as CommissionRateView;
      expect(rate.id).toBe(id);
      expect(rate.amount).toBe(55);
      expect(typeof rate.amount).toBe('number');
      expect(rate.userId).toBe(userId);
      expect(rate.clientId).toBe(dims.clientId);
      // joined display fields — proves it's the VIEW, not the bare row
      expect(rate.userName).toBe('CR_GET');
      expect(rate.clientName).toBeTruthy();
      expect(rate.productCode).toBeTruthy();
      expect(rate.verificationUnitName).toBeTruthy();
      expect(rate.pincode).toBeTruthy();
    });

    it('404s an unknown id', async () => {
      const res = await request(app).get('/api/v2/commission-rates/999999').set(SA);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('COMMISSION_RATE_NOT_FOUND');
    });

    it('401s an unauthenticated request', async () => {
      const res = await request(app).get('/api/v2/commission-rates/1');
      expect(res.status).toBe(401);
    });

    it('403s an actor without masterdata.manage (comp data is SA-only)', async () => {
      // FIELD_AGENT holds neither perm; MANAGER holds masterdata.VIEW but NOT masterdata.manage.
      expect((await request(app).get('/api/v2/commission-rates/1').set(FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/commission-rates/1').set(MGR)).status).toBe(403);
    });
  });

  describe('GET /lookups/territory (field-user territory — bulk/single location picker source)', () => {
    // Assign one (pincode, area) location to a field user via the generic scope API (AREA dimension).
    const assignArea = async (userId: string, locationId: number) => {
      const res = await request(app)
        .post(`/api/v2/users/${userId}/scope-assignments`)
        .set(SA)
        .send({ dimension: 'AREA', entityIds: [locationId] });
      expect(res.status).toBe(200);
    };

    it('returns only the field user’s assigned locations, ordered by pincode/area', async () => {
      const userId = await newUser('terr_u1');
      const locB = await seedId('locations', {
        pincode: '400071',
        area: 'ZONE_B',
        city: 'Mumbai',
        state: 'MH',
      });
      const locA = await seedId('locations', {
        pincode: '400071',
        area: 'ZONE_A',
        city: 'Mumbai',
        state: 'MH',
      });
      const unassigned = await seedId('locations', {
        pincode: '400072',
        area: 'ZONE_C',
        city: 'Mumbai',
        state: 'MH',
      });
      await assignArea(userId, locB);
      await assignArea(userId, locA);

      const res = await request(app)
        .get(`/api/v2/commission-rates/lookups/territory?userId=${userId}`)
        .set(SA);
      expect(res.status).toBe(200);
      const rows = res.body as { id: number; area: string; pincode: string; city: string }[];
      expect(rows.map((r) => r.id).sort()).toEqual([locA, locB].sort((a, b) => a - b));
      expect(rows.map((r) => r.id)).not.toContain(unassigned);
      // ordered by pincode then area → ZONE_A before ZONE_B (same pincode)
      expect(rows.map((r) => r.area)).toEqual(['ZONE_A', 'ZONE_B']);
      expect(rows[0]!.pincode).toBe('400071'); // display fields present for the picker
      expect(rows[0]!.city).toBeTruthy();
    });

    it('returns [] for a field user with no territory assigned', async () => {
      const userId = await newUser('terr_empty');
      const res = await request(app)
        .get(`/api/v2/commission-rates/lookups/territory?userId=${userId}`)
        .set(SA);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('gated masterdata.manage — FIELD_AGENT + MANAGER denied (403)', async () => {
      const userId = await newUser('terr_perm');
      const url = `/api/v2/commission-rates/lookups/territory?userId=${userId}`;
      expect((await request(app).get(url).set(FA)).status).toBe(403);
      expect((await request(app).get(url).set(MGR)).status).toBe(403);
    });

    it('bad userId → 400', async () => {
      const res = await request(app)
        .get('/api/v2/commission-rates/lookups/territory?userId=not-a-uuid')
        .set(SA);
      expect(res.status).toBe(400);
    });
  });

  describe('POST /bulk (multi-location bulk entry)', () => {
    const assignArea = async (userId: string, locationId: number) => {
      const res = await request(app)
        .post(`/api/v2/users/${userId}/scope-assignments`)
        .set(SA)
        .send({ dimension: 'AREA', entityIds: [locationId] });
      expect(res.status).toBe(200);
    };
    const seedLoc = (pincode: string, area: string) =>
      seedId('locations', { pincode, area, city: 'Mumbai', state: 'MH' });
    const bulk = (body: object, auth = SA) =>
      request(app).post('/api/v2/commission-rates/bulk').set(auth).send(body);

    it('creates one rate per assigned location (all CREATED) and grows the list', async () => {
      const userId = await newUser('blk_all');
      const l1 = await seedLoc('400081', 'BAREA1');
      const l2 = await seedLoc('400081', 'BAREA2');
      const l3 = await seedLoc('400082', 'BAREA3');
      for (const l of [l1, l2, l3]) await assignArea(userId, l);
      const res = await bulk({ userId, fieldRateType: 'LOCAL', amount: 150, locationIds: [l1, l2, l3] });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ createdCount: 3, existsCount: 0, errorCount: 0 });
      expect(res.body.results.every((r: { status: string }) => r.status === 'CREATED')).toBe(true);
      const list = await request(app).get(`/api/v2/commission-rates?userId=${userId}`).set(SA);
      expect(list.body.totalCount).toBe(3);
    });

    it('skips an already-existing location as EXISTS, creates the rest, never overwrites (partial success)', async () => {
      const userId = await newUser('blk_dup');
      const l1 = await seedLoc('400083', 'DAREA1');
      const l2 = await seedLoc('400083', 'DAREA2');
      await assignArea(userId, l1);
      await assignArea(userId, l2);
      const pre = await request(app)
        .post('/api/v2/commission-rates')
        .set(SA)
        .send({ userId, fieldRateType: 'LOCAL', locationId: l1, amount: 140 });
      expect(pre.status).toBe(201);
      const res = await bulk({ userId, fieldRateType: 'LOCAL', amount: 150, locationIds: [l1, l2] });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ createdCount: 1, existsCount: 1, errorCount: 0 });
      const byLoc = Object.fromEntries(
        res.body.results.map((r: { locationId: number; status: string }) => [r.locationId, r.status]),
      );
      expect(byLoc[l1]).toBe('EXISTS');
      expect(byLoc[l2]).toBe('CREATED');
      // the pre-existing rate kept its own amount (never overwritten)
      const list = await request(app).get(`/api/v2/commission-rates?userId=${userId}`).set(SA);
      const l1row = (list.body.items as { locationId: number; amount: number }[]).find(
        (r) => r.locationId === l1,
      )!;
      expect(l1row.amount).toBe(140);
    });

    it('flags a location outside the agent’s territory as ERROR NOT_IN_TERRITORY (others still created)', async () => {
      const userId = await newUser('blk_terr');
      const assigned = await seedLoc('400084', 'TAREA1');
      const outside = await seedLoc('400084', 'TAREA2'); // seeded but NOT assigned to the user
      await assignArea(userId, assigned);
      const res = await bulk({
        userId,
        fieldRateType: 'LOCAL',
        amount: 150,
        locationIds: [assigned, outside],
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ createdCount: 1, errorCount: 1 });
      const byLoc = Object.fromEntries(
        res.body.results.map((r: { locationId: number; status: string; error: string | null }) => [
          r.locationId,
          r,
        ]),
      );
      expect(byLoc[outside]).toMatchObject({ status: 'ERROR', error: 'NOT_IN_TERRITORY' });
    });

    it('reactivation runs the one-type guard: Deactivate LOCAL → add OGL → Activate LOCAL → 409', async () => {
      const userId = await newUser('blk_react');
      const loc = await seedLoc('400089', 'XAREA1');
      await assignArea(userId, loc);
      const local = await request(app)
        .post('/api/v2/commission-rates')
        .set(SA)
        .send({ userId, fieldRateType: 'LOCAL', locationId: loc, amount: 100 });
      expect(local.status).toBe(201);
      const off = await request(app)
        .post(`/api/v2/commission-rates/${local.body.id}/deactivate`)
        .set(SA)
        .send({ version: 1 });
      expect(off.status).toBe(200);
      // LOCAL is inactive → OGL may take over the location…
      const ogl = await request(app)
        .post('/api/v2/commission-rates')
        .set(SA)
        .send({ userId, fieldRateType: 'OGL', locationId: loc, amount: 90 });
      expect(ogl.status).toBe(201);
      // …so resurrecting the old LOCAL row must be blocked (else two active types coexist).
      const back = await request(app)
        .post(`/api/v2/commission-rates/${local.body.id}/activate`)
        .set(SA)
        .send({ version: 2 });
      expect(back.status).toBe(409);
      expect(back.body.error).toBe('HAS_OTHER_RATE_TYPE');
    });

    it('one location = one rate type (owner 2026-07-11): a location holding another type errors per-row, the rest create', async () => {
      const userId = await newUser('blk_1type');
      const l1 = await seedLoc('400088', 'RAREA1');
      const l2 = await seedLoc('400088', 'RAREA2');
      await assignArea(userId, l1);
      await assignArea(userId, l2);
      // l1 already has LOCAL — bulk OGL over [l1, l2] must error l1 and create l2.
      const pre = await request(app)
        .post('/api/v2/commission-rates')
        .set(SA)
        .send({ userId, fieldRateType: 'LOCAL', locationId: l1, amount: 140 });
      expect(pre.status).toBe(201);
      const res = await bulk({ userId, fieldRateType: 'OGL', amount: 150, locationIds: [l1, l2] });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ createdCount: 1, existsCount: 0, errorCount: 1 });
      const byLoc = Object.fromEntries(
        res.body.results.map((r: { locationId: number; status: string; error: string | null }) => [
          r.locationId,
          r,
        ]),
      );
      expect(byLoc[l1]).toMatchObject({ status: 'ERROR', error: 'HAS_OTHER_RATE_TYPE' });
      expect(byLoc[l2]).toMatchObject({ status: 'CREATED' });
    });

    it('rejects an admin-defined OFFICE-category code and an unknown code — the guard is catalog-driven', async () => {
      const userId = await newUser('blk_cat');
      const loc = await seedLoc('400087', 'CAREA1');
      await assignArea(userId, loc);
      // An OFFICE-category type with a NON-'OFFICE' code is as location-less as the literal OFFICE.
      const mk = await request(app)
        .post('/api/v2/rate-types')
        .set(SA)
        .send({ code: 'KYC_DESK', name: 'KYC Desk', category: 'OFFICE' });
      expect(mk.status).toBe(201);
      const desk = await bulk({ userId, fieldRateType: 'KYC_DESK', amount: 150, locationIds: [loc] });
      expect(desk.status).toBe(400);
      expect(desk.body.error).toBe('OFFICE_NOT_BULKABLE');
      // Unknown codes must 400, not fan dead NULL-rate_type_id rows reported CREATED.
      const ghost = await bulk({ userId, fieldRateType: 'GHOST_TYPE', amount: 150, locationIds: [loc] });
      expect(ghost.status).toBe(400);
      expect(ghost.body.error).toBe('INVALID_RATE_TYPE');
    });

    it('rejects an OFFICE rate type (400) and a user with no territory (400)', async () => {
      const fieldUser = await newUser('blk_field');
      const loc = await seedLoc('400085', 'OAREA1');
      await assignArea(fieldUser, loc);
      const office = await bulk({
        userId: fieldUser,
        fieldRateType: 'OFFICE',
        amount: 150,
        locationIds: [loc],
      });
      expect(office.status).toBe(400);
      expect(office.body.error).toBe('OFFICE_NOT_BULKABLE');
      const mgrId = await newUserRole('blk_mgr', 'MANAGER');
      const nonField = await bulk({ userId: mgrId, fieldRateType: 'LOCAL', amount: 150, locationIds: [loc] });
      expect(nonField.status).toBe(400);
      expect(nonField.body.error).toBe('USER_HAS_NO_TERRITORY');
    });

    it('gated masterdata.manage — FIELD_AGENT + MANAGER denied (403)', async () => {
      const userId = await newUser('blk_perm');
      const loc = await seedLoc('400086', 'PAREA1');
      const body = { userId, fieldRateType: 'LOCAL', amount: 150, locationIds: [loc] };
      expect((await bulk(body, FA)).status).toBe(403);
      expect((await bulk(body, MGR)).status).toBe(403);
    });

    it('validates input: empty locationIds → 400', async () => {
      const userId = await newUser('blk_empty');
      const res = await bulk({ userId, fieldRateType: 'LOCAL', amount: 150, locationIds: [] });
      expect(res.status).toBe(400);
    });
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

    it('confirm imports an admin-defined catalog rate-type code (ADR-0068) — LOCAL1 was rejected by the old enum', async () => {
      await newUser('imp_rt_user');
      // 'local1' (lowercased) exercises the toUpper transform → matches the migration-seeded catalog code LOCAL1.
      const res = await upload('confirm', await mkXlsx([row('imp_rt_user', 'local1', 77)]));
      expect(res.status).toBe(200);
      expect(res.body.successRows).toBe(1);
      const list = await request(app).get('/api/v2/commission-rates').set(SA);
      expect(list.body.items[0]).toMatchObject({ fieldRateType: 'LOCAL1', amount: 77 });
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

    it('export carries the resolution dimensions (product/unit/location/tat band/currency) — no ambiguity, location never dropped', async () => {
      await request(app).post('/api/v2/commission-rates').set(SA).send({
        userId: dimUserId,
        clientId,
        locationId: locId,
        productId: prodId,
        verificationUnitId: vuId,
        fieldRateType: 'LOCAL',
        tatBand: 24,
        amount: 70,
      });
      const res = await request(app)
        .get(`/api/v2/commission-rates/export?format=csv&mode=all&userId=${dimUserId}`)
        .set(SA);
      expect(res.status).toBe(200);
      const [header, ...rows] = res.text.split('\r\n');
      expect(header).toBe(
        'User,Client,Rate Type,Product,Unit,Location,TAT Band,Amount,Currency,Status,Effective From,Created,Updated',
      );
      const row = rows.find((l) => l.includes('411001'))!;
      expect(row).toContain('411001 DIMAREA'); // ADR-0046 location — a REQUIRED LOCAL/OGL key (was dropped pre-fix)
      expect(row).toContain('P_DIM'); // product dimension
      expect(row).toContain('24h'); // completed-in TAT band
      expect(row).toContain('INR'); // currency
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
