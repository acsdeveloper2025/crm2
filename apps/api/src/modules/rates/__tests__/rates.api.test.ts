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

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BE = authHeaderForRole('BACKEND_USER');

const newClient = async (code: string) =>
  (await request(app).post('/api/v2/clients').set(SA).send(clientFactory({ code }))).body.id as number;
const newProduct = async (code: string) =>
  (await request(app).post('/api/v2/products').set(SA).send(productFactory({ code }))).body.id as number;
const newUnit = async (code: string) =>
  (await request(app).post('/api/v2/verification-units').set(SA).send(verificationUnitFactory({ code }))).body
    .id as number;

describe.skipIf(!RUN)('rates API', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate('clients', 'products', 'verification_units', 'locations', 'import_log');
  });

  const seedKey = async (n: string) => ({
    clientId: await newClient(`C_${n}`),
    productId: await newProduct(`P_${n}`),
    verificationUnitId: await newUnit(`U_${n}`),
  });

  it('creates a rate (201), returns numeric amount, and lists the joined view', async () => {
    const key = await seedKey('R1');
    const created = await request(app)
      .post('/api/v2/rates')
      .set(SA)
      .send({ ...key, amount: 50 });
    expect(created.status).toBe(201);
    expect(created.body.amount).toBe(50);
    expect(created.body.currency).toBe('INR');
    expect(typeof created.body.amount).toBe('number');

    const list = await request(app).get('/api/v2/rates').set(SA);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.totalCount).toBe(1);
    expect(list.body.items[0].clientCode).toBe('C_R1');
    expect(list.body.items[0].unitName).toBeTruthy();
    expect(list.body.sort).toEqual({ sortBy: 'client', sortOrder: 'asc' });
  });

  it('paginates and server-sorts by amount asc; rejects limit>500; injection-safe sort', async () => {
    for (const a of [10, 20, 30]) {
      const key = await seedKey(`PG${a}`);
      const res = await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, amount: a });
      expect(res.status).toBe(201);
    }
    const p1 = await request(app).get('/api/v2/rates?limit=2&page=1&sortBy=amount&sortOrder=asc').set(SA);
    expect(p1.body.items.map((r: { amount: number }) => r.amount)).toEqual([10, 20]);
    expect(p1.body.totalCount).toBe(3);
    expect(p1.body.totalPages).toBe(2);
    const p2 = await request(app).get('/api/v2/rates?limit=2&page=2&sortBy=amount&sortOrder=asc').set(SA);
    expect(p2.body.items.map((r: { amount: number }) => r.amount)).toEqual([30]);

    const tooLarge = await request(app).get('/api/v2/rates?limit=501').set(SA);
    expect(tooLarge.status).toBe(400);
    expect(tooLarge.body.error).toBe('LIMIT_TOO_LARGE');

    const inj = await request(app).get('/api/v2/rates?sortBy=r.amount;DROP TABLE rates').set(SA);
    expect(inj.status).toBe(200);
    expect(inj.body.sort.sortBy).toBe('client'); // default, not the injection string
  });

  it('global search filters by client/product/unit/pincode/area/rate type', async () => {
    const key = await seedKey('SRCH');
    await request(app)
      .post('/api/v2/rates')
      .set(SA)
      .send({ ...key, amount: 99 });
    const hit = await request(app).get('/api/v2/rates?search=C_SRCH').set(SA);
    expect(hit.body.items).toHaveLength(1);
    expect(hit.body.items[0].clientCode).toBe('C_SRCH');
    expect(hit.body.filters.search).toBe('C_SRCH');
    const miss = await request(app).get('/api/v2/rates?search=ZZZ_NOPE').set(SA);
    expect(miss.body.items).toHaveLength(0);
    expect(miss.body.totalCount).toBe(0);
  });

  // ── column filters on JOINED columns (DATAGRID_STANDARD §6/§7); count + items share RATE_FROM ──
  it('f_unit (text, on the joined vu.name) filters count AND items, and echoes', async () => {
    const key = await seedKey('FLT');
    await request(app)
      .post('/api/v2/rates')
      .set(SA)
      .send({ ...key, amount: 42 });
    const created = (await request(app).get('/api/v2/rates').set(SA)).body.items as {
      verificationUnitId: number;
      unitName: string;
    }[];
    const unitName = created.find((r) => r.verificationUnitId === key.verificationUnitId)!.unitName;
    const hit = await request(app)
      .get(`/api/v2/rates?f_unit=${encodeURIComponent(unitName)}`)
      .set(SA);
    expect(hit.body.totalCount).toBe(1); // count applied the joined filter (no count/items divergence)
    expect(hit.body.items).toHaveLength(1);
    expect(hit.body.filters.f_unit).toBe(unitName);
    const none = await request(app).get('/api/v2/rates?f_unit=ZZZ_NO_SUCH_UNIT').set(SA);
    expect(none.body.totalCount).toBe(0);
  });

  it('rejects a negative amount with 400 VALIDATION', async () => {
    const key = await seedKey('R2');
    const res = await request(app)
      .post('/api/v2/rates')
      .set(SA)
      .send({ ...key, amount: -5 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION');
  });

  it('duplicate (client+product+unit) → 409', async () => {
    const key = await seedKey('R3');
    await request(app)
      .post('/api/v2/rates')
      .set(SA)
      .send({ ...key, amount: 50 });
    const dup = await request(app)
      .post('/api/v2/rates')
      .set(SA)
      .send({ ...key, amount: 70 });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('RATE_EXISTS');
  });

  it('unknown reference → 400 INVALID_REFERENCE', async () => {
    const productId = await newProduct('P_R4');
    const verificationUnitId = await newUnit('U_R4');
    const res = await request(app)
      .post('/api/v2/rates')
      .set(SA)
      .send({ clientId: 999999, productId, verificationUnitId, amount: 50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_REFERENCE');
  });

  it('update changes only the amount', async () => {
    const key = await seedKey('R5');
    const created = (
      await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, amount: 50 })
    ).body;
    expect(created.version).toBe(1);
    const upd = await request(app)
      .put(`/api/v2/rates/${created.id}`)
      .set(SA)
      .send({ amount: 125.5, version: 1 });
    expect(upd.status).toBe(200);
    expect(upd.body.amount).toBe(125.5);
    expect(upd.body.version).toBe(2);
  });

  it('BACKEND_USER cannot create (403) but can read', async () => {
    const key = await seedKey('R6');
    const create = await request(app)
      .post('/api/v2/rates')
      .set(BE)
      .send({ ...key, amount: 50 });
    expect(create.status).toBe(403);
    expect((await request(app).get('/api/v2/rates').set(BE)).status).toBe(200);
  });

  it('unauthenticated request is 401', async () => {
    expect((await request(app).get('/api/v2/rates')).status).toBe(401);
  });

  it('activate / deactivate toggles is_active', async () => {
    const key = await seedKey('R7');
    const created = (
      await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, amount: 50 })
    ).body;
    const off = await request(app)
      .post(`/api/v2/rates/${created.id}/deactivate`)
      .set(SA)
      .send({ version: 1 });
    expect(off.body.isActive).toBe(false);
    expect(off.body.version).toBe(2);
    const on = await request(app).post(`/api/v2/rates/${created.id}/activate`).set(SA).send({ version: 2 });
    expect(on.body.isActive).toBe(true);
    expect(on.body.version).toBe(3);
  });

  // ── flat model (0013): free-text client_rate_type + location + effective-dated versioning ─────────
  const newLocation = async (area: string) =>
    (
      await request(app)
        .post('/api/v2/locations')
        .set(SA)
        .send({ pincode: '400001', area, city: 'Mumbai', state: 'MH' })
    ).body.id as number;

  it('prices a row with a free-text rate type + geography (location); joins pincode/area', async () => {
    const key = await seedKey('R8');
    const locationId = await newLocation('Andheri_R8');

    const ok = await request(app)
      .post('/api/v2/rates')
      .set(SA)
      .send({ ...key, locationId, clientRateType: 'OGL', amount: 350 });
    expect(ok.status).toBe(201);
    expect(ok.body.clientRateType).toBe('OGL');
    expect(ok.body.locationId).toBe(locationId);

    const list = await request(app).get(`/api/v2/rates?clientId=${key.clientId}`).set(SA);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].pincode).toBe('400001');
    expect(list.body.items[0].area).toBe('ANDHERI_R8');
    expect(list.body.items[0].clientRateType).toBe('OGL');

    // a KYC-style row: same unit, no location, no rate type → distinct from the OGL row (no overlap)
    const flat = await request(app)
      .post('/api/v2/rates')
      .set(SA)
      .send({ ...key, amount: 150 });
    expect(flat.status).toBe(201);
    expect(flat.body.clientRateType).toBeNull();
    expect(flat.body.locationId).toBeNull();
  });

  it('409 when an active rate already overlaps the same scope + period', async () => {
    const key = await seedKey('R8B');
    const locationId = await newLocation('BANDRA_R8B');
    const body = { ...key, locationId, clientRateType: 'LOCAL', amount: 300 };
    expect((await request(app).post('/api/v2/rates').set(SA).send(body)).status).toBe(201);
    const dup = await request(app)
      .post('/api/v2/rates')
      .set(SA)
      .send({ ...body, amount: 400 });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('RATE_EXISTS');
  });

  // ── Universal (NULL) product / verification unit (ADR-0071) ──────────────────────────────────────
  it('creates a Universal-product rate (productId omitted → null) and lists it (LEFT JOIN keeps the row)', async () => {
    const key = await seedKey('UPROD');
    const res = await request(app)
      .post('/api/v2/rates')
      .set(SA)
      .send({ clientId: key.clientId, verificationUnitId: key.verificationUnitId, amount: 75 });
    expect(res.status).toBe(201);
    expect(res.body.productId).toBeNull();
    const list = await request(app).get(`/api/v2/rates?clientId=${key.clientId}`).set(SA);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].productId).toBeNull();
    expect(list.body.items[0].productCode).toBeNull(); // null product → no join row, but rate still listed
    expect(list.body.items[0].unitName).toBeTruthy();
  });

  it('creates a Universal-unit rate (verificationUnitId omitted → null), null unit in the view', async () => {
    const key = await seedKey('UUNIT');
    const res = await request(app)
      .post('/api/v2/rates')
      .set(SA)
      .send({ clientId: key.clientId, productId: key.productId, amount: 80 });
    expect(res.status).toBe(201);
    expect(res.body.verificationUnitId).toBeNull();
    const list = await request(app).get(`/api/v2/rates?clientId=${key.clientId}`).set(SA);
    expect(list.body.items[0].verificationUnitId).toBeNull();
    expect(list.body.items[0].unitName).toBeNull();
    expect(list.body.items[0].productCode).toBeTruthy();
  });

  it('creates a fully-Universal rate (product + unit both null)', async () => {
    const key = await seedKey('UALL');
    const res = await request(app).post('/api/v2/rates').set(SA).send({ clientId: key.clientId, amount: 60 });
    expect(res.status).toBe(201);
    expect(res.body.productId).toBeNull();
    expect(res.body.verificationUnitId).toBeNull();
  });

  it('a specific rate and a Universal-product rate coexist (no overlap collision)', async () => {
    const key = await seedKey('UCO');
    const specific = await request(app)
      .post('/api/v2/rates')
      .set(SA)
      .send({ ...key, amount: 500 });
    expect(specific.status).toBe(201);
    const universal = await request(app)
      .post('/api/v2/rates')
      .set(SA)
      .send({ clientId: key.clientId, verificationUnitId: key.verificationUnitId, amount: 100 });
    expect(universal.status).toBe(201); // COALESCE(product,-1) differs from the specific product → no collision
  });

  it('two fully-Universal rates for the same client collide → 409 RATE_EXISTS', async () => {
    const key = await seedKey('UDUP');
    expect(
      (await request(app).post('/api/v2/rates').set(SA).send({ clientId: key.clientId, amount: 60 })).status,
    ).toBe(201);
    const dup = await request(app).post('/api/v2/rates').set(SA).send({ clientId: key.clientId, amount: 70 });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('RATE_EXISTS');
  });

  it('revise inserts a new effective-dated version, end-dates the prior, and records history', async () => {
    const key = await seedKey('R9');
    const created = (
      await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, amount: 100 })
    ).body;

    const revised = await request(app)
      .post(`/api/v2/rates/${created.id}/revise`)
      .set(SA)
      .send({ amount: 150, version: 1 });
    expect(revised.status).toBe(200);
    expect(revised.body.amount).toBe(150);
    expect(revised.body.id).not.toBe(created.id); // a NEW version row
    expect(revised.body.effectiveTo).toBeNull();

    // current view shows ONE row (the new version); history view shows both
    const current = await request(app).get(`/api/v2/rates?clientId=${key.clientId}`).set(SA);
    expect(current.body.items).toHaveLength(1);
    expect(current.body.items[0].amount).toBe(150);

    const all = await request(app).get(`/api/v2/rates?clientId=${key.clientId}&history=true`).set(SA);
    expect(all.body.items).toHaveLength(2);

    // the prior version is end-dated, never overwritten
    const prior = all.body.items.find((r: { id: number }) => r.id === created.id);
    expect(prior.amount).toBe(100);
    expect(prior.effectiveTo).not.toBeNull();

    const history = await request(app).get(`/api/v2/rates/${revised.body.id}/history`).set(SA);
    expect(history.status).toBe(200);
    expect(history.body.map((h: { action: string }) => h.action).sort()).toEqual(['CREATE', 'REVISE']);
  });

  // ── OCC contract (ADR-0019, C-10) ────────────────────────────────────────────────────────
  const createRate = async (n: string, amount = 50) => {
    const key = await seedKey(n);
    return (
      await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, amount })
    ).body as { id: number; version: number };
  };

  it('update without a version → 400 VERSION_REQUIRED', async () => {
    const created = await createRate('OCC1');
    const res = await request(app).put(`/api/v2/rates/${created.id}`).set(SA).send({ amount: 75 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VERSION_REQUIRED');
  });

  it('update a non-existent id (with version) → 404 RATE_NOT_FOUND', async () => {
    const res = await request(app).put('/api/v2/rates/999999').set(SA).send({ amount: 75, version: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('RATE_NOT_FOUND');
  });

  it('concurrent updateAmount: the second stale writer → 409 STALE_UPDATE', async () => {
    const created = await createRate('OCC3');
    const a = await request(app).put(`/api/v2/rates/${created.id}`).set(SA).send({ amount: 75, version: 1 });
    expect(a.status).toBe(200);
    expect(a.body.version).toBe(2);
    const b = await request(app).put(`/api/v2/rates/${created.id}`).set(SA).send({ amount: 90, version: 1 });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe('STALE_UPDATE');
    expect(b.body.details.current.version).toBe(2);
  });

  it('revise with a stale version → 409 STALE_UPDATE', async () => {
    const created = await createRate('OCC4', 100);
    const first = await request(app)
      .put(`/api/v2/rates/${created.id}`)
      .set(SA)
      .send({ amount: 110, version: 1 });
    expect(first.status).toBe(200);
    const stale = await request(app)
      .post(`/api/v2/rates/${created.id}/revise`)
      .set(SA)
      .send({ amount: 150, version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('STALE_UPDATE');
  });

  it('deactivate is version-guarded: a second stale deactivate → 409', async () => {
    const created = await createRate('OCC5');
    const off = await request(app)
      .post(`/api/v2/rates/${created.id}/deactivate`)
      .set(SA)
      .send({ version: 1 });
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);
    expect(off.body.version).toBe(2);
    const again = await request(app)
      .post(`/api/v2/rates/${created.id}/deactivate`)
      .set(SA)
      .send({ version: 1 });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe('STALE_UPDATE');
  });

  // ── D4 record-page loader: GET /:id returns the joined RateView (ADR-0051) ──
  describe('get by id', () => {
    const FA = authHeaderForRole('FIELD_AGENT'); // no page.masterdata

    it('returns the created rate as a joined RateView (200 + names) for a MASTERDATA_VIEW caller', async () => {
      const key = await seedKey('GET1');
      const locationId = await newLocation('GETAREA');
      const created = (
        await request(app)
          .post('/api/v2/rates')
          .set(SA)
          .send({ ...key, locationId, clientRateType: 'OGL', amount: 275 })
      ).body as { id: number };

      // BACKEND_USER has page.masterdata (read) but cannot write — a valid VIEW-perm caller
      const res = await request(app).get(`/api/v2/rates/${created.id}`).set(BE);
      expect(res.status).toBe(200);
      expect(res.body.id).toBe(created.id);
      expect(typeof res.body.amount).toBe('number');
      expect(res.body.amount).toBe(275);
      // the JOINED view shape (names, not just ids) — what the list returns
      expect(res.body.clientCode).toBe('C_GET1');
      expect(res.body.clientName).toBeTruthy();
      expect(res.body.productCode).toBe('P_GET1');
      expect(res.body.unitName).toBeTruthy();
      expect(res.body.pincode).toBe('400001');
      expect(res.body.area).toBe('GETAREA');
      expect(res.body.clientRateType).toBe('OGL');
    });

    it('a non-existent id → 404 RATE_NOT_FOUND', async () => {
      const res = await request(app).get('/api/v2/rates/999999').set(SA);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('RATE_NOT_FOUND');
    });

    it('a caller without page.masterdata cannot read (403); unauth is 401', async () => {
      const key = await seedKey('GET3');
      const created = (
        await request(app)
          .post('/api/v2/rates')
          .set(SA)
          .send({ ...key, amount: 50 })
      ).body as { id: number };
      expect((await request(app).get(`/api/v2/rates/${created.id}`).set(FA)).status).toBe(403);
      expect((await request(app).get(`/api/v2/rates/${created.id}`)).status).toBe(401);
    });
  });

  // ── B-13 DataGrid export (IMPORT_EXPORT_STANDARD) ──
  describe('export', () => {
    const FA = authHeaderForRole('FIELD_AGENT');

    it('exports the current view as CSV (200 + headers + joined row)', async () => {
      const key = await seedKey('EXP1');
      await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, amount: 50 });
      const res = await request(app).get('/api/v2/rates/export?format=csv&mode=current').set(SA);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="rates-\d{8}\.csv"/);
      expect(res.text.split('\r\n')[0]).toBe(
        'Client,Product,Verification Unit,Pincode,Area,Rate Type,Rate,Currency,Effective From,Effective To,Created,Updated,Status',
      );
      expect(res.text).toContain('C_EXP1,P_EXP1');
      expect(res.text).toContain(',INR,'); // currency now exported (lossless round-trip)
    });

    it('exports all matching as XLSX (200 + PK-zip body)', async () => {
      const key = await seedKey('EXP2');
      await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, amount: 50 });
      const res = await request(app)
        .get('/api/v2/rates/export?format=xlsx&mode=all')
        .set(SA)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect((res.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
    });

    it('respects the visible columns (cols) selection', async () => {
      const key = await seedKey('EXP3');
      await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, amount: 50 });
      const res = await request(app)
        .get('/api/v2/rates/export?format=csv&mode=all&cols=client,amount,status')
        .set(SA);
      expect(res.text.split('\r\n')[0]).toBe('Client,Rate,Status');
    });

    it('mode=selected exports only the ticked ids (not the whole list)', async () => {
      const keyA = await seedKey('SELA');
      const a = (
        await request(app)
          .post('/api/v2/rates')
          .set(SA)
          .send({ ...keyA, amount: 50 })
      ).body as { id: number };
      const keyB = await seedKey('SELB');
      await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...keyB, amount: 60 });
      const res = await request(app).get(`/api/v2/rates/export?format=csv&mode=selected&ids=${a.id}`).set(SA);
      expect(res.status).toBe(200);
      expect(res.text.split('\r\n')[0]).toBe(
        'Client,Product,Verification Unit,Pincode,Area,Rate Type,Rate,Currency,Effective From,Effective To,Created,Updated,Status',
      );
      expect(res.text).toContain('C_SELA');
      expect(res.text).not.toContain('C_SELB'); // the unticked row is excluded
    });

    it('mode=selected with no ids exports nothing (never falls through to all)', async () => {
      const key = await seedKey('NOIDS');
      await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, amount: 50 });
      const res = await request(app).get('/api/v2/rates/export?format=csv&mode=selected').set(SA);
      expect(res.status).toBe(200);
      expect(res.text.split('\r\n')).toHaveLength(1); // header only, zero data rows
    });

    it('rejects an unknown format with 400', async () => {
      const res = await request(app).get('/api/v2/rates/export?format=pdf').set(SA);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_EXPORT_FORMAT');
    });

    it('a role without data.export cannot export (403)', async () => {
      expect((await request(app).get('/api/v2/rates/export').set(FA)).status).toBe(403);
    });

    it('unauthenticated export is 401', async () => {
      expect((await request(app).get('/api/v2/rates/export')).status).toBe(401);
    });

    // BACKEND_USER holds page.masterdata in the day-0 seed (0033_roles.sql) — so this is the
    // "a masterdata viewer keeps its export" leg. (On PRODUCTION the same role has had
    // page.masterdata stripped by ADR-0077, which is exactly why the gate matters there.)
    it('BACKEND_USER (holds page.masterdata) can still export (200)', async () => {
      expect((await request(app).get('/api/v2/rates/export?format=csv').set(BE)).status).toBe(200);
    });
  });

  // ── bulk activate/deactivate (per-row OCC, CONCURRENCY_AND_EDITING_STANDARD §1) ──
  describe('bulk', () => {
    const FA = authHeaderForRole('FIELD_AGENT');

    it('bulk-deactivate applies per-row and reports all OK', async () => {
      const a = await createRate('BA');
      const b = await createRate('BB');
      const res = await request(app)
        .post('/api/v2/rates/bulk-deactivate')
        .set(SA)
        .send({
          items: [
            { id: a.id, version: a.version },
            { id: b.id, version: b.version },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ okCount: 2, conflictCount: 0, notFoundCount: 0 });
      expect((await request(app).get(`/api/v2/rates?active=false`).set(SA)).body.totalCount).toBe(2);
    });

    it('mixed batch → per-row OK / CONFLICT (stale version) / NOT_FOUND, no silent overwrite', async () => {
      const ok = await createRate('BOK');
      const stale = await createRate('BSTALE');
      // bump `stale` so the version the batch carries is now behind
      await request(app)
        .post(`/api/v2/rates/${stale.id}/deactivate`)
        .set(SA)
        .send({ version: stale.version });
      const res = await request(app)
        .post('/api/v2/rates/bulk-deactivate')
        .set(SA)
        .send({
          items: [
            { id: ok.id, version: ok.version },
            { id: stale.id, version: stale.version }, // stale → CONFLICT
            { id: 999999, version: 1 }, // missing → NOT_FOUND
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ okCount: 1, conflictCount: 1, notFoundCount: 1 });
      const byId = Object.fromEntries(
        (res.body.results as { id: string; status: string }[]).map((r) => [r.id, r.status]),
      );
      expect(byId[String(ok.id)]).toBe('OK');
      expect(byId[String(stale.id)]).toBe('CONFLICT');
      expect(byId['999999']).toBe('NOT_FOUND');
    });

    it('empty items → 400 BULK_ITEMS_REQUIRED', async () => {
      const res = await request(app).post('/api/v2/rates/bulk-activate').set(SA).send({ items: [] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BULK_ITEMS_REQUIRED');
    });

    it('a role without masterdata.manage cannot bulk-mutate (403); unauth is 401', async () => {
      expect(
        (await request(app).post('/api/v2/rates/bulk-deactivate').set(FA).send({ items: [] })).status,
      ).toBe(403);
      expect((await request(app).post('/api/v2/rates/bulk-deactivate').send({ items: [] })).status).toBe(401);
    });
  });

  // ── POST /bulk (multi-location bulk entry): one client bill-rate fanned across many locations ──
  describe('POST /bulk (multi-location bulk entry)', () => {
    const FA = authHeaderForRole('FIELD_AGENT');
    let pincodeSeq = 500000;
    const seedLoc = async (area: string, pincode = String(++pincodeSeq)) =>
      (
        await request(app)
          .post('/api/v2/locations')
          .set(SA)
          .send({ pincode, area, city: 'Mumbai', state: 'MH' })
      ).body.id as number;
    const bulk = (body: object, auth = SA) => request(app).post('/api/v2/rates/bulk').set(auth).send(body);

    it('creates one rate per location (all CREATED), grows the list, and appends per-row history', async () => {
      const key = await seedKey('BLK1');
      const l1 = await seedLoc('BAREA1');
      const l2 = await seedLoc('BAREA2');
      const l3 = await seedLoc('BAREA3');
      const res = await bulk({ ...key, clientRateType: 'LOCAL', amount: 150, locationIds: [l1, l2, l3] });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ createdCount: 3, existsCount: 0, errorCount: 0 });
      expect(res.body.results.every((r: { status: string }) => r.status === 'CREATED')).toBe(true);
      const list = await request(app).get('/api/v2/rates').set(SA);
      expect(list.body.totalCount).toBe(3);
      // audit parity with single create: every fanned row has its own rate_history CREATE entry
      const rateId = res.body.results[0].rateId as number;
      const hist = await request(app).get(`/api/v2/rates/${rateId}/history`).set(SA);
      expect(hist.status).toBe(200);
      expect(hist.body).toHaveLength(1);
      expect(hist.body[0].action).toBe('CREATE');
    });

    it('skips an already-existing location as EXISTS, creates the rest, never overwrites (partial success)', async () => {
      const key = await seedKey('BLK2');
      const l1 = await seedLoc('DAREA1');
      const l2 = await seedLoc('DAREA2');
      const pre = await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, locationId: l1, clientRateType: 'LOCAL', amount: 140 });
      expect(pre.status).toBe(201);
      const res = await bulk({ ...key, clientRateType: 'LOCAL', amount: 150, locationIds: [l1, l2] });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ createdCount: 1, existsCount: 1, errorCount: 0 });
      const byLoc = Object.fromEntries(
        res.body.results.map((r: { locationId: number; status: string }) => [r.locationId, r.status]),
      );
      expect(byLoc[l1]).toBe('EXISTS');
      expect(byLoc[l2]).toBe('CREATED');
      // the pre-existing rate kept its own amount (never overwritten)
      const list = await request(app).get('/api/v2/rates').set(SA);
      const l1row = (list.body.items as { locationId: number; amount: number }[]).find(
        (r) => r.locationId === l1,
      )!;
      expect(l1row.amount).toBe(140);
    });

    it('one slot = one rate type (owner 2026-07-11): a location holding another type errors per-row, the rest create', async () => {
      const key = await seedKey('BLK3');
      const l1 = await seedLoc('RAREA1');
      const l2 = await seedLoc('RAREA2');
      // l1 already has LOCAL at this exact slot — bulk OGL over [l1, l2] must error l1 and create l2.
      const pre = await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, locationId: l1, clientRateType: 'LOCAL', amount: 140 });
      expect(pre.status).toBe(201);
      const res = await bulk({ ...key, clientRateType: 'OGL', amount: 150, locationIds: [l1, l2] });
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

    it('the one-type slot is (client, product, unit, location): a DIFFERENT product at the same location is allowed', async () => {
      const key = await seedKey('BLK4');
      const otherProduct = await newProduct('P_BLK4B');
      const loc = await seedLoc('SAREA1');
      const pre = await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, locationId: loc, clientRateType: 'LOCAL', amount: 140 });
      expect(pre.status).toBe(201);
      // same client + unit + location but ANOTHER product → a distinct slot, OGL is legal there
      const res = await bulk({
        ...key,
        productId: otherProduct,
        clientRateType: 'OGL',
        amount: 150,
        locationIds: [loc],
      });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ createdCount: 1, errorCount: 0 });
    });

    it('single create at a slot holding another type → 409 HAS_OTHER_RATE_TYPE (import routes here too)', async () => {
      const key = await seedKey('BLK5');
      const loc = await seedLoc('QAREA1');
      const pre = await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, locationId: loc, clientRateType: 'LOCAL', amount: 140 });
      expect(pre.status).toBe(201);
      const dup = await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, locationId: loc, clientRateType: 'OGL', amount: 150 });
      expect(dup.status).toBe(409);
      expect(dup.body.error).toBe('HAS_OTHER_RATE_TYPE');
    });

    it('single create with an unknown rate-type code → 400 INVALID_RATE_TYPE (never a silent typeless rate)', async () => {
      const key = await seedKey('BLK5B');
      const loc = await seedLoc('WAREA1');
      const res = await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, locationId: loc, clientRateType: 'LOCLA', amount: 150 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('INVALID_RATE_TYPE');
      expect((await request(app).get('/api/v2/rates').set(SA)).body.totalCount).toBe(0);
    });

    it('the one-slot guard is symmetric on typeless rows: typed↔typeless at the same slot both block', async () => {
      const key = await seedKey('BLK5C');
      const loc = await seedLoc('YAREA1');
      // a legitimately typeless located rate (legacy/office-less line — no rate type)
      const typeless = await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, locationId: loc, amount: 900 });
      expect(typeless.status).toBe(201);
      // a TYPED rate can't plant a second billing line at the same slot…
      const typed = await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, locationId: loc, clientRateType: 'LOCAL', amount: 140 });
      expect(typed.status).toBe(409);
      expect(typed.body.error).toBe('HAS_OTHER_RATE_TYPE');
      // …and the reverse (typeless over a typed slot) is blocked too — the guard runs for typeless saves.
      const key2 = await seedKey('BLK5D');
      const loc2 = await seedLoc('YAREA2');
      const local = await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key2, locationId: loc2, clientRateType: 'LOCAL', amount: 140 });
      expect(local.status).toBe(201);
      const planted = await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key2, locationId: loc2, amount: 900 }); // typeless plant
      expect(planted.status).toBe(409);
      expect(planted.body.error).toBe('HAS_OTHER_RATE_TYPE');
    });

    it('reactivation runs the one-type guard: Deactivate LOCAL → add OGL → Activate LOCAL → 409 (single + bulk CONFLICT)', async () => {
      const key = await seedKey('BLK6');
      const loc = await seedLoc('XAREA1');
      const local = await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, locationId: loc, clientRateType: 'LOCAL', amount: 100 });
      expect(local.status).toBe(201);
      const off = await request(app)
        .post(`/api/v2/rates/${local.body.id}/deactivate`)
        .set(SA)
        .send({ version: 1 });
      expect(off.status).toBe(200);
      // LOCAL is inactive → OGL may take over the slot…
      const ogl = await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, locationId: loc, clientRateType: 'OGL', amount: 90 });
      expect(ogl.status).toBe(201);
      // …so resurrecting the old LOCAL row must be blocked (else two active types coexist).
      const back = await request(app)
        .post(`/api/v2/rates/${local.body.id}/activate`)
        .set(SA)
        .send({ version: 2 });
      expect(back.status).toBe(409);
      expect(back.body.error).toBe('HAS_OTHER_RATE_TYPE');
      // bulk-activate takes the same guarded path → per-row CONFLICT, not a resurrected second type
      const bulkBack = await request(app)
        .post('/api/v2/rates/bulk-activate')
        .set(SA)
        .send({ items: [{ id: local.body.id, version: 2 }] });
      expect(bulkBack.status).toBe(200);
      expect(bulkBack.body).toMatchObject({ okCount: 0, conflictCount: 1 });
    });

    it('bulk-activate reports a RATE_EXISTS resurrection as per-row CONFLICT (not a whole-batch abort)', async () => {
      const key = await seedKey('BLK6B');
      const loc = await seedLoc('ZAREA1');
      const ok = await createRate('BLK6B_OK'); // a plain rate that will re-activate cleanly
      const okDeact = await request(app)
        .post(`/api/v2/rates/${ok.id}/deactivate`)
        .set(SA)
        .send({ version: ok.version });
      const okVersion = okDeact.body.version as number; // deactivate bumped the OCC token
      const first = await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, locationId: loc, clientRateType: 'LOCAL', amount: 100 });
      expect(first.status).toBe(201);
      await request(app).post(`/api/v2/rates/${first.body.id}/deactivate`).set(SA).send({ version: 1 });
      // a NEW active LOCAL now occupies the exact slot (allowed — the old one is inactive)…
      const second = await request(app)
        .post('/api/v2/rates')
        .set(SA)
        .send({ ...key, locationId: loc, clientRateType: 'LOCAL', amount: 120 });
      expect(second.status).toBe(201);
      // …so re-activating the OLD LOCAL would overlap → RATE_EXISTS, reported per-row, batch survives.
      const res = await request(app)
        .post('/api/v2/rates/bulk-activate')
        .set(SA)
        .send({
          items: [
            { id: ok.id, version: okVersion },
            { id: first.body.id, version: 2 },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ okCount: 1, conflictCount: 1 });
      const byId = Object.fromEntries(
        (res.body.results as { id: string; status: string }[]).map((r) => [r.id, r.status]),
      );
      expect(byId[String(ok.id)]).toBe('OK');
      expect(byId[String(first.body.id)]).toBe('CONFLICT');
    });

    it('rejects an unknown code (400 INVALID_RATE_TYPE) and an OFFICE-category code (400 OFFICE_NOT_BULKABLE)', async () => {
      const key = await seedKey('BLK7');
      const loc = await seedLoc('CAREA1');
      const ghost = await bulk({ ...key, clientRateType: 'GHOST_TYPE', amount: 150, locationIds: [loc] });
      expect(ghost.status).toBe(400);
      expect(ghost.body.error).toBe('INVALID_RATE_TYPE');
      const office = await bulk({ ...key, clientRateType: 'OFFICE', amount: 150, locationIds: [loc] });
      expect(office.status).toBe(400);
      expect(office.body.error).toBe('OFFICE_NOT_BULKABLE');
    });

    it('flags a nonexistent location as ERROR INVALID_REFERENCE (others still created)', async () => {
      const key = await seedKey('BLK8');
      const loc = await seedLoc('IAREA1');
      const res = await bulk({ ...key, clientRateType: 'LOCAL', amount: 150, locationIds: [loc, 999999] });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ createdCount: 1, errorCount: 1 });
      const byLoc = Object.fromEntries(
        res.body.results.map((r: { locationId: number; status: string; error: string | null }) => [
          r.locationId,
          r,
        ]),
      );
      expect(byLoc[999999]).toMatchObject({ status: 'ERROR', error: 'INVALID_REFERENCE' });
    });

    it('validates input: empty locationIds → 400; gated masterdata.manage (403/401)', async () => {
      const key = await seedKey('BLK9');
      const loc = await seedLoc('GAREA1');
      expect((await bulk({ ...key, clientRateType: 'LOCAL', amount: 150, locationIds: [] })).status).toBe(
        400,
      );
      const body = { ...key, clientRateType: 'LOCAL', amount: 150, locationIds: [loc] };
      expect((await bulk(body, FA)).status).toBe(403);
      expect((await request(app).post('/api/v2/rates/bulk').send(body)).status).toBe(401);
    });

    // ADR-0093 guard × ADR-0071 Universal: the one-slot-one-type rule must hold when the product/unit
    // dims are Universal (NULL) exactly as it does for concrete dims — the slot is still one slot.
    // Characterization test: it PASSES on today's code (the scalar guard predicate is null-aware via
    // COALESCE(...,-1)). It exists to pin that behaviour, because a plausible "widen the guard to
    // productIds[]" refactor silently breaks it: `= ANY(ARRAY[NULL]::int[])` evaluates to NULL, the row
    // is dropped by WHERE, the guard finds no conflict and two differently-typed active rates land at
    // one slot. rates_no_overlap does NOT catch that (rate_type_id is part of the EXCLUDE key).
    it('a Universal-product LOCAL rate blocks a Universal-product OGL rate at the same location', async () => {
      const key = await seedKey('UGRD'); // only clientId is used — the dims are deliberately Universal
      const locationId = await seedLoc('UGRD_AREA');
      const body = {
        clientId: key.clientId,
        productId: null, // Universal (ADR-0071)
        verificationUnitId: null, // Universal
        clientRateType: 'LOCAL',
        amount: 175,
        locationIds: [locationId],
      };
      const first = await bulk(body);
      expect(first.status).toBe(200);
      expect(first.body.createdCount).toBe(1);

      // Same Universal slot, same location, DIFFERENT rate type ⇒ one slot may hold only one type.
      const second = await bulk({ ...body, clientRateType: 'OGL', amount: 220 });
      expect(second.status).toBe(200);
      expect(second.body.createdCount).toBe(0);
      expect(second.body.errorCount).toBe(1);
      expect(second.body.results[0].status).toBe('ERROR');
      expect(second.body.results[0].error).toBe('HAS_OTHER_RATE_TYPE');
    });
  });

  // ── B-14 import (the only FK-resolving domain): file carries CODES + pincode/area → resolve → ids ──
  describe('import', () => {
    const FA = authHeaderForRole('FIELD_AGENT');
    const HEADER = ['Client Code', 'Product Code', 'Unit Code', 'Pincode', 'Area', 'Rate Type', 'Amount'];

    // Build an .xlsx upload in-memory (header row + the given data rows).
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
        .post(`/api/v2/rates/import?mode=${mode}`)
        .set(auth)
        .set('content-type', 'application/octet-stream')
        .set('x-filename', 'rates.xlsx')
        .send(buf);

    // Seed the codes the import resolves: client HDFC, product HOME_LOAN, a VU, a location (pincode+area).
    const seedRefs = async () => {
      await request(app)
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code: 'HDFC' }));
      await request(app)
        .post('/api/v2/products')
        .set(SA)
        .send(productFactory({ code: 'HOME_LOAN' }));
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'RESI' }));
      await request(app)
        .post('/api/v2/locations')
        .set(SA)
        .send({ pincode: '400001', area: 'Fort', city: 'Mumbai', state: 'MH' });
    };

    it('downloads an XLSX template (200 + PK body + filename)', async () => {
      const res = await request(app)
        .get('/api/v2/rates/import-template')
        .set(SA)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('rates-import-template.xlsx');
      expect((res.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
    });

    it('preview resolves known codes (valid) and flags an unknown client code (errorRows)', async () => {
      await seedRefs();
      const res = await upload(
        'preview',
        await mkXlsx([
          ['HDFC', 'HOME_LOAN', 'RESI', '400001', 'Fort', 'Local', 500],
          ['NOPE', 'HOME_LOAN', 'RESI', '400001', 'Fort', 'Local', 600],
        ]),
      );
      expect(res.status).toBe(200);
      expect(res.body.validRows).toBe(1);
      expect(res.body.errorRows).toBe(1);
      expect(res.body.errors[0]).toMatchObject({ column: 'Client Code' });
      // preview is read-only — no rate rows written
      expect((await request(app).get('/api/v2/rates').set(SA)).body.totalCount).toBe(0);
    });

    it('confirm imports the valid row, writes the import_log audit record, and grows the rates list', async () => {
      await seedRefs();
      const res = await upload(
        'confirm',
        await mkXlsx([['HDFC', 'HOME_LOAN', 'RESI', '400001', 'Fort', 'Local', 500]]),
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalRows: 1, successRows: 1, failedRows: 0 });
      const list = await request(app).get('/api/v2/rates').set(SA);
      expect(list.body.totalCount).toBe(1);
      expect(list.body.items[0].clientCode).toBe('HDFC');
      expect(Number(list.body.items[0].amount)).toBe(500);
      const log = await db!.pool.query(`SELECT resource FROM import_log WHERE resource='rates'`);
      expect(log.rows).toHaveLength(1);
    });

    it('a role without masterdata.manage cannot import or get the template (403); unauth is 401', async () => {
      expect(
        (await upload('preview', await mkXlsx([['HDFC', 'HOME_LOAN', 'RESI', '', '', '', 1]]), FA)).status,
      ).toBe(403);
      expect((await request(app).get('/api/v2/rates/import-template').set(FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/rates/import-template')).status).toBe(401);
    });

    it('template teaches every shape: 3 sample rows + a Notes sheet naming the live rate-type codes', async () => {
      const res = await request(app)
        .get('/api/v2/rates/import-template')
        .set(SA)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(res.body as unknown as Parameters<typeof wb.xlsx.load>[0]);
      const [data, notes] = wb.worksheets;
      // header + one sample per shape (located field / flat office-KYC / UNIVERSAL product+unit)
      expect(data!.actualRowCount).toBe(4);
      expect(data!.getRow(4).getCell(2).text).toBe('UNIVERSAL');
      expect(notes?.name).toBe('Notes');
      const notesText = JSON.stringify(notes!.getSheetValues());
      expect(notesText).toContain('UNIVERSAL');
      expect(notesText).toContain('LOCAL'); // live catalog codes listed
      expect(notesText).toContain('One location holds ONE rate type');
    });

    it('the UNIVERSAL literal imports a Universal product+unit rate; a blank product stays an error', async () => {
      await seedRefs();
      const res = await upload(
        'confirm',
        await mkXlsx([
          ['HDFC', 'UNIVERSAL', 'UNIVERSAL', '400001', 'Fort', 'Local', 650],
          ['HDFC', '', 'RESI', '', '', '', 300], // blank product = error, never silently Universal
        ]),
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalRows: 2, successRows: 1, failedRows: 1 });
      const list = await request(app).get('/api/v2/rates').set(SA);
      expect(list.body.totalCount).toBe(1);
      expect(list.body.items[0].productId).toBeNull();
      expect(list.body.items[0].verificationUnitId).toBeNull();
    });

    it('a typo’d rate type is a row error (never a silent typeless rate)', async () => {
      await seedRefs();
      const res = await upload(
        'preview',
        await mkXlsx([['HDFC', 'HOME_LOAN', 'RESI', '400001', 'Fort', 'LOCLA', 500]]),
      );
      expect(res.status).toBe(200);
      expect(res.body.errorRows).toBe(1);
      expect(res.body.errors[0]).toMatchObject({ column: 'Rate Type' });
      expect(res.body.errors[0].message).toContain('unknown rate type');
    });

    it('import surfaces the one-type rule per row: a location holding another type fails with the rule named', async () => {
      await seedRefs();
      const pre = await upload(
        'confirm',
        await mkXlsx([['HDFC', 'HOME_LOAN', 'RESI', '400001', 'Fort', 'Local', 500]]),
      );
      expect(pre.body.successRows).toBe(1);
      const res = await upload(
        'confirm',
        await mkXlsx([['HDFC', 'HOME_LOAN', 'RESI', '400001', 'Fort', 'OGL', 650]]),
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalRows: 1, successRows: 0, failedRows: 1 });
      expect(res.body.errors[0].message).toContain('one location holds one rate type');
      // the pre-existing LOCAL rate is untouched
      const list = await request(app).get('/api/v2/rates').set(SA);
      expect(list.body.totalCount).toBe(1);
      expect(list.body.items[0].clientRateType).toBe('LOCAL');
    });
  });
});
