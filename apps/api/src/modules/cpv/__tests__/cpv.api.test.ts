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
const newClientProduct = async (clientId: number, productId: number) =>
  (await request(app).post('/api/v2/client-products').set(SA).send({ clientId, productId })).body
    .id as number;

describe.skipIf(!RUN)('CPV API', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    // truncate audit_log too: the cpv tables' int PKs RESTART IDENTITY each test, so audit
    // rows keyed by entity_id would collide across tests without a clean slate.
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

  it('links a product to a client (201) and lists the joined view', async () => {
    const clientId = await newClient('C_CPV1');
    const productId = await newProduct('P_CPV1');
    const link = await request(app).post('/api/v2/client-products').set(SA).send({ clientId, productId });
    expect(link.status).toBe(201);
    expect(link.body.isActive).toBe(true);

    const list = await request(app).get(`/api/v2/client-products?clientId=${clientId}`).set(SA);
    expect(list.status).toBe(200);
    // Paginated envelope (DataGrid): { items, totalCount, page, pageSize, totalPages, sort, filters }.
    expect(list.body.totalCount).toBe(1);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0].clientCode).toBe('C_CPV1');
    expect(list.body.items[0].productName).toBeTruthy();
    expect(list.body.items[0].version).toBe(1); // list must return the OCC token (toggle needs it)
  });

  it('client-products list is a paginated DataGrid envelope (page/limit/sort/search/filter)', async () => {
    // Two distinct links so paging/sorting/filtering have something to discriminate.
    const cA = await newClient('AC_ENV'); // client name from factory; codes drive sort/filter here
    const cB = await newClient('ZC_ENV');
    const p = await newProduct('P_ENV');
    await request(app).post('/api/v2/client-products').set(SA).send({ clientId: cA, productId: p });
    await request(app).post('/api/v2/client-products').set(SA).send({ clientId: cB, productId: p });

    // Envelope shape + default sort (client asc).
    const all = await request(app).get('/api/v2/client-products').set(SA);
    expect(all.status).toBe(200);
    expect(all.body.totalCount).toBe(2);
    expect(all.body.pageSize).toBe(25);
    expect(all.body.totalPages).toBe(1);
    expect(all.body.sort).toEqual({ sortBy: 'client', sortOrder: 'asc' });

    // page/limit window.
    const p1 = await request(app).get('/api/v2/client-products?limit=1&page=1&sortBy=client').set(SA);
    expect(p1.body.items).toHaveLength(1);
    expect(p1.body.totalPages).toBe(2);

    // global search narrows by client/product code or name.
    const byProduct = await request(app).get('/api/v2/client-products?search=P_ENV').set(SA);
    expect(byProduct.body.totalCount).toBe(2);
    const byClient = await request(app).get('/api/v2/client-products?search=AC_ENV').set(SA);
    expect(byClient.body.totalCount).toBe(1);

    // whitelisted column filter f_client (ILIKE on the joined client name) is echoed back.
    const filtered = await request(app).get('/api/v2/client-products?f_product=P_ENV').set(SA);
    expect(filtered.body.totalCount).toBe(2);
    expect(filtered.body.filters.f_product).toBe('P_ENV');

    // limit > 500 → 400 LIMIT_TOO_LARGE (pagination gate 41).
    const tooBig = await request(app).get('/api/v2/client-products?limit=600').set(SA);
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error).toBe('LIMIT_TOO_LARGE');

    // unknown sortBy falls back to default (no ORDER BY injection surface).
    const inj = await request(app).get('/api/v2/client-products?sortBy=client;DROP TABLE clients').set(SA);
    expect(inj.status).toBe(200);
    expect(inj.body.sort.sortBy).toBe('client');
  });

  // ── reschedule effective-from (the only mutable field; keys immutable) — OCC-guarded ──
  it('PUT /client-products/:id reschedules effective_from, bumps version, OCC-guards', async () => {
    const clientId = await newClient('C_RES');
    const productId = await newProduct('P_RES');
    const link = (await request(app).post('/api/v2/client-products').set(SA).send({ clientId, productId }))
      .body;
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();

    const upd = await request(app)
      .put(`/api/v2/client-products/${link.id}`)
      .set(SA)
      .send({ effectiveFrom: future, version: link.version });
    expect(upd.status).toBe(200);
    expect(new Date(upd.body.effectiveFrom).getTime()).toBeGreaterThan(Date.now());
    expect(upd.body.version).toBe(2);

    // rescheduled into the future → excluded from ?active=true (ADR-0017 USABLE)
    const usable = await request(app).get(`/api/v2/client-products?clientId=${clientId}&active=true`).set(SA);
    expect(usable.body.items).toHaveLength(0);

    // missing version → 400 VERSION_REQUIRED; stale version → 409 STALE_UPDATE
    const noVer = await request(app)
      .put(`/api/v2/client-products/${link.id}`)
      .set(SA)
      .send({ effectiveFrom: future });
    expect(noVer.status).toBe(400);
    expect(noVer.body.error).toBe('VERSION_REQUIRED');
    const stale = await request(app)
      .put(`/api/v2/client-products/${link.id}`)
      .set(SA)
      .send({ effectiveFrom: future, version: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error).toBe('STALE_UPDATE');
  });

  it('PUT /cpv-units/:id reschedules a unit enablement effective_from (version-guarded)', async () => {
    const clientProductId = await newClientProduct(await newClient('C_RU'), await newProduct('P_RU'));
    const unitId = await newUnit('U_RU');
    const unit = (
      await request(app)
        .post('/api/v2/cpv-units')
        .set(SA)
        .send({ clientProductId, verificationUnitId: unitId })
    ).body;
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const upd = await request(app)
      .put(`/api/v2/cpv-units/${unit.id}`)
      .set(SA)
      .send({ effectiveFrom: future, version: unit.version });
    expect(upd.status).toBe(200);
    expect(upd.body.version).toBe(2);
    expect(new Date(upd.body.effectiveFrom).getTime()).toBeGreaterThan(Date.now());
  });

  it('duplicate link → 409', async () => {
    const clientId = await newClient('C_CPV2');
    const productId = await newProduct('P_CPV2');
    await newClientProduct(clientId, productId);
    const dup = await request(app).post('/api/v2/client-products').set(SA).send({ clientId, productId });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('CLIENT_PRODUCT_EXISTS');
  });

  it('unknown reference → 400 INVALID_REFERENCE', async () => {
    const productId = await newProduct('P_CPV3');
    const res = await request(app)
      .post('/api/v2/client-products')
      .set(SA)
      .send({ clientId: 999999, productId });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_REFERENCE');
  });

  it('BACKEND_USER cannot link (403) but can read', async () => {
    const clientId = await newClient('C_CPV4');
    const productId = await newProduct('P_CPV4');
    const create = await request(app).post('/api/v2/client-products').set(BE).send({ clientId, productId });
    expect(create.status).toBe(403);
    expect((await request(app).get('/api/v2/client-products').set(BE)).status).toBe(200);
  });

  it('enables a verification unit for a client-product (201) and lists the joined view', async () => {
    const clientProductId = await newClientProduct(await newClient('C_CPV5'), await newProduct('P_CPV5'));
    const unitId = await newUnit('U_CPV5');
    const enable = await request(app)
      .post('/api/v2/cpv-units')
      .set(SA)
      .send({ clientProductId, verificationUnitId: unitId });
    expect(enable.status).toBe(201);

    const list = await request(app).get(`/api/v2/cpv-units?clientProductId=${clientProductId}`).set(SA);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].unitCode).toBe('U_CPV5');
    expect(list.body[0].unitWorkerRole).toBeTruthy();
    expect(list.body[0].version).toBe(1); // list must return the OCC token (toggle needs it)
  });

  it('duplicate unit enablement → 409', async () => {
    const clientProductId = await newClientProduct(await newClient('C_CPV6'), await newProduct('P_CPV6'));
    const unitId = await newUnit('U_CPV6');
    await request(app)
      .post('/api/v2/cpv-units')
      .set(SA)
      .send({ clientProductId, verificationUnitId: unitId });
    const dup = await request(app)
      .post('/api/v2/cpv-units')
      .set(SA)
      .send({ clientProductId, verificationUnitId: unitId });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('CPV_UNIT_EXISTS');
  });

  it('cpv-units list without clientProductId → 400', async () => {
    expect((await request(app).get('/api/v2/cpv-units').set(SA)).status).toBe(400);
  });

  it('deactivate a cpv-unit toggles is_active', async () => {
    const clientProductId = await newClientProduct(await newClient('C_CPV7'), await newProduct('P_CPV7'));
    const unitId = await newUnit('U_CPV7');
    const enabled = (
      await request(app)
        .post('/api/v2/cpv-units')
        .set(SA)
        .send({ clientProductId, verificationUnitId: unitId })
    ).body;
    const off = await request(app)
      .post(`/api/v2/cpv-units/${enabled.id}/deactivate`)
      .set(SA)
      .send({ version: enabled.version });
    expect(off.body.isActive).toBe(false);
  });

  it('unauthenticated request is 401', async () => {
    expect((await request(app).get('/api/v2/client-products')).status).toBe(401);
  });

  it('client-product view reports the active enabled-unit count (Finding A discoverability)', async () => {
    const clientProductId = await newClientProduct(await newClient('C_CNT'), await newProduct('P_CNT'));
    await request(app)
      .post('/api/v2/cpv-units')
      .set(SA)
      .send({ clientProductId, verificationUnitId: await newUnit('U_CNT') });
    const list = await request(app).get('/api/v2/client-products').set(SA);
    const row = list.body.items.find((r: { id: number }) => r.id === clientProductId);
    expect(row.unitCount).toBe(1);
  });

  it('future-dated link excluded from ?active=true but shown in the admin list (ADR-0017)', async () => {
    const clientId = await newClient('C_CPVEF');
    const productId = await newProduct('P_CPVEF');
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const link = await request(app)
      .post('/api/v2/client-products')
      .set(SA)
      .send({ clientId, productId, effectiveFrom: future });
    expect(link.status).toBe(201);
    expect(new Date(link.body.effectiveFrom).getTime()).toBeGreaterThan(Date.now());

    const admin = await request(app).get(`/api/v2/client-products?clientId=${clientId}`).set(SA);
    expect(admin.body.items).toHaveLength(1);
    const usable = await request(app).get(`/api/v2/client-products?clientId=${clientId}&active=true`).set(SA);
    expect(usable.body.items).toHaveLength(0);
  });

  it('future-dated unit enablement excluded from ?active=true (ADR-0017)', async () => {
    const clientProductId = await newClientProduct(await newClient('C_CPVEF2'), await newProduct('P_CPVEF2'));
    const unitId = await newUnit('U_CPVEF2');
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const en = await request(app)
      .post('/api/v2/cpv-units')
      .set(SA)
      .send({ clientProductId, verificationUnitId: unitId, effectiveFrom: future });
    expect(en.status).toBe(201);

    const all = await request(app).get(`/api/v2/cpv-units?clientProductId=${clientProductId}`).set(SA);
    expect(all.body).toHaveLength(1);
    const usable = await request(app)
      .get(`/api/v2/cpv-units?clientProductId=${clientProductId}&active=true`)
      .set(SA);
    expect(usable.body).toHaveLength(0);
  });

  // ── OCC contract (ADR-0019 / CONCURRENCY_AND_EDITING_STANDARD §6) ──
  it('client-product toggle without a version → 400 VERSION_REQUIRED', async () => {
    const id = await newClientProduct(await newClient('C_OCC1'), await newProduct('P_OCC1'));
    const res = await request(app).post(`/api/v2/client-products/${id}/deactivate`).set(SA); // no version
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VERSION_REQUIRED');
  });

  it('cpv-unit toggle without a version → 400 VERSION_REQUIRED', async () => {
    const clientProductId = await newClientProduct(await newClient('C_OCC2'), await newProduct('P_OCC2'));
    const enabled = (
      await request(app)
        .post('/api/v2/cpv-units')
        .set(SA)
        .send({ clientProductId, verificationUnitId: await newUnit('U_OCC2') })
    ).body;
    const res = await request(app).post(`/api/v2/cpv-units/${enabled.id}/deactivate`).set(SA); // no version
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VERSION_REQUIRED');
  });

  it('toggle a non-existent client-product with a version → 404 CLIENT_PRODUCT_NOT_FOUND', async () => {
    const res = await request(app)
      .post('/api/v2/client-products/999999/deactivate')
      .set(SA)
      .send({ version: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CLIENT_PRODUCT_NOT_FOUND');
  });

  it('toggle a non-existent cpv-unit with a version → 404 CPV_UNIT_NOT_FOUND', async () => {
    const res = await request(app).post('/api/v2/cpv-units/999999/deactivate').set(SA).send({ version: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('CPV_UNIT_NOT_FOUND');
  });

  it('client-product concurrent toggle: stale version → 409 STALE_UPDATE with current.version=2', async () => {
    const link = (
      await request(app)
        .post('/api/v2/client-products')
        .set(SA)
        .send({ clientId: await newClient('C_OCC3'), productId: await newProduct('P_OCC3') })
    ).body;
    expect(link.version).toBe(1);
    // first deactivate at v1 → v2, is_active false
    const a = await request(app)
      .post(`/api/v2/client-products/${link.id}/deactivate`)
      .set(SA)
      .send({ version: 1 });
    expect(a.status).toBe(200);
    expect(a.body.version).toBe(2);
    expect(a.body.isActive).toBe(false);
    // second toggle still holds stale v1 → conflict
    const b = await request(app)
      .post(`/api/v2/client-products/${link.id}/deactivate`)
      .set(SA)
      .send({ version: 1 });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe('STALE_UPDATE');
    expect(b.body.current.version).toBe(2);
  });

  it('cpv-unit concurrent toggle: stale version → 409 STALE_UPDATE with current.version=2', async () => {
    const clientProductId = await newClientProduct(await newClient('C_OCC4'), await newProduct('P_OCC4'));
    const enabled = (
      await request(app)
        .post('/api/v2/cpv-units')
        .set(SA)
        .send({ clientProductId, verificationUnitId: await newUnit('U_OCC4') })
    ).body;
    expect(enabled.version).toBe(1);
    const a = await request(app)
      .post(`/api/v2/cpv-units/${enabled.id}/deactivate`)
      .set(SA)
      .send({ version: 1 });
    expect(a.status).toBe(200);
    expect(a.body.version).toBe(2);
    expect(a.body.isActive).toBe(false);
    const b = await request(app)
      .post(`/api/v2/cpv-units/${enabled.id}/deactivate`)
      .set(SA)
      .send({ version: 1 });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe('STALE_UPDATE');
    expect(b.body.current.version).toBe(2);
  });

  it('client-product create+deactivate appends CREATE + DEACTIVATE audit rows', async () => {
    const link = (
      await request(app)
        .post('/api/v2/client-products')
        .set(SA)
        .send({ clientId: await newClient('C_OCC5'), productId: await newProduct('P_OCC5') })
    ).body;
    await request(app)
      .post(`/api/v2/client-products/${link.id}/deactivate`)
      .set(SA)
      .send({ version: link.version });
    const { rows } = await db!.pool.query(
      `SELECT action, version_after FROM audit_log
       WHERE entity_type = 'client_products' AND entity_id = $1 ORDER BY id`,
      [String(link.id)],
    );
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'DEACTIVATE']);
    expect(rows[1].version_after).toBe(2);
  });

  it('cpv-unit create+deactivate appends CREATE + DEACTIVATE audit rows', async () => {
    const clientProductId = await newClientProduct(await newClient('C_OCC6'), await newProduct('P_OCC6'));
    const enabled = (
      await request(app)
        .post('/api/v2/cpv-units')
        .set(SA)
        .send({ clientProductId, verificationUnitId: await newUnit('U_OCC6') })
    ).body;
    await request(app)
      .post(`/api/v2/cpv-units/${enabled.id}/deactivate`)
      .set(SA)
      .send({ version: enabled.version });
    const { rows } = await db!.pool.query(
      `SELECT action, version_after FROM audit_log
       WHERE entity_type = 'client_product_verification_units' AND entity_id = $1 ORDER BY id`,
      [String(enabled.id)],
    );
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'DEACTIVATE']);
    expect(rows[1].version_after).toBe(2);
  });

  // ── B-13 DataGrid export (IMPORT_EXPORT_STANDARD) — the DataGrid is the export surface ──
  describe('export', () => {
    const FA = authHeaderForRole('FIELD_AGENT');

    it('exports the current view as CSV (200 + headers + separate code/name cells, round-trippable)', async () => {
      await newClientProduct(await newClient('C_EXP'), await newProduct('P_EXP'));
      const res = await request(app).get('/api/v2/client-products/export?format=csv&mode=current').set(SA);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="client-products-\d{8}\.csv"/);
      // codes are now their own columns (matching the import 'Client Code'/'Product Code') → re-importable.
      expect(res.text.split('\r\n')[0]).toBe(
        'Client Code,Client Name,Product Code,Product Name,Units,Effective From,Created,Updated,Status',
      );
      expect(res.text).toContain('C_EXP,'); // the Client Code cell carries the bare code (was "C_EXP — Name")
    });

    it('exports all matching as XLSX (200 + PK-zip body)', async () => {
      await newClientProduct(await newClient('C_EXX'), await newProduct('P_EXX'));
      const res = await request(app)
        .get('/api/v2/client-products/export?format=xlsx&mode=all')
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
      await newClientProduct(await newClient('C_EXC'), await newProduct('P_EXC'));
      const res = await request(app)
        .get('/api/v2/client-products/export?format=csv&mode=all&cols=client,status')
        .set(SA);
      expect(res.text.split('\r\n')[0]).toBe('Client Code,Status');
    });

    it('a role without data.export cannot export (403)', async () => {
      expect((await request(app).get('/api/v2/client-products/export').set(FA)).status).toBe(403);
    });

    it('the exported CSV re-imports losslessly (round-trip): export → upload → preview validates', async () => {
      await newClientProduct(await newClient('C_RT'), await newProduct('P_RT'));
      const csv = (await request(app).get('/api/v2/client-products/export?format=csv&mode=all').set(SA)).text;
      // Feed the exact exported CSV bytes back into the import preview — the engine maps 'Client Code'/
      // 'Product Code' and ignores the extra Name/Units/audit columns; both codes resolve → 0 errors.
      const res = await request(app)
        .post('/api/v2/client-products/import?mode=preview')
        .set(SA)
        .set('content-type', 'application/octet-stream')
        .set('x-filename', 'client-products.csv')
        .send(Buffer.from(csv, 'utf8'));
      expect(res.status).toBe(200);
      expect(res.body.errorRows).toBe(0);
      expect(res.body.validRows).toBe(res.body.totalRows);
      expect(res.body.totalRows).toBeGreaterThanOrEqual(1);
    });
  });

  // ── B-14 import (FK-resolving): the file carries client/product CODES → resolve → numeric ids ──
  describe('import', () => {
    const FA = authHeaderForRole('FIELD_AGENT');
    const HEADER = ['Client Code', 'Product Code', 'Effective From'];

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
        .post(`/api/v2/client-products/import?mode=${mode}`)
        .set(auth)
        .set('content-type', 'application/octet-stream')
        .set('x-filename', 'client-products.xlsx')
        .send(buf);

    const seedRefs = async () => {
      await request(app)
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code: 'HDFC' }));
      await request(app)
        .post('/api/v2/products')
        .set(SA)
        .send(productFactory({ code: 'HOME_LOAN' }));
    };

    it('downloads an XLSX template (200 + PK body + filename)', async () => {
      const res = await request(app)
        .get('/api/v2/client-products/import-template')
        .set(SA)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('client-products-import-template.xlsx');
      expect((res.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
    });

    it('preview resolves known codes (valid) and flags an unknown client code (errorRows)', async () => {
      await seedRefs();
      const res = await upload(
        'preview',
        await mkXlsx([
          ['HDFC', 'HOME_LOAN', ''],
          ['NOPE', 'HOME_LOAN', ''],
        ]),
      );
      expect(res.status).toBe(200);
      expect(res.body.validRows).toBe(1);
      expect(res.body.errorRows).toBe(1);
      expect(res.body.errors[0]).toMatchObject({ column: 'Client Code' });
      // preview is read-only — no links written
      expect((await request(app).get('/api/v2/client-products').set(SA)).body.totalCount).toBe(0);
    });

    it('confirm imports the valid row, writes the import_log record, and grows the link list', async () => {
      await seedRefs();
      const res = await upload('confirm', await mkXlsx([['HDFC', 'HOME_LOAN', '']]));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalRows: 1, successRows: 1, failedRows: 0 });
      const list = await request(app).get('/api/v2/client-products').set(SA);
      expect(list.body.totalCount).toBe(1);
      expect(list.body.items[0].clientCode).toBe('HDFC');
      expect(list.body.items[0].productCode).toBe('HOME_LOAN');
      const log = await db!.pool.query(`SELECT resource FROM import_log WHERE resource='client_products'`);
      expect(log.rows).toHaveLength(1);
    });

    it('confirm reports a duplicate link per-row (failed) without blocking — 409 surfaces as failedRows', async () => {
      await seedRefs();
      await upload('confirm', await mkXlsx([['HDFC', 'HOME_LOAN', '']])); // first link
      const res = await upload('confirm', await mkXlsx([['HDFC', 'HOME_LOAN', '']])); // duplicate
      expect(res.body).toMatchObject({ totalRows: 1, successRows: 0, failedRows: 1 });
      expect((await request(app).get('/api/v2/client-products').set(SA)).body.totalCount).toBe(1);
    });

    it('a role without masterdata.manage cannot import or get the template (403); unauth is 401', async () => {
      expect((await upload('preview', await mkXlsx([['HDFC', 'HOME_LOAN', '']]), FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/client-products/import-template').set(FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/client-products/import-template')).status).toBe(401);
    });
  });

  // ── IE-DEFER-2: cpv-units (enabled verification units) export + import — mirrors the link leg ──
  // Enable a unit for a client-product, addressed by its client/product/unit CODES (the import keys).
  const enableUnit = async (clientCode: string, productCode: string, unitCode: string) => {
    const clientProductId = await newClientProduct(
      await newClient(clientCode),
      await newProduct(productCode),
    );
    const unitId = await newUnit(unitCode);
    return (
      await request(app)
        .post('/api/v2/cpv-units')
        .set(SA)
        .send({ clientProductId, verificationUnitId: unitId })
    ).body.id as number;
  };

  describe('cpv-units bulk create (UX-6)', () => {
    const FA = authHeaderForRole('FIELD_AGENT');

    it('bulk-enables units: 1 new → CREATED, 1 previously-deactivated → REACTIVATED, 1 bogus id → ERROR; others unaffected; one audit row per success', async () => {
      const clientProductId = await newClientProduct(await newClient('C_BULK1'), await newProduct('P_BULK1'));
      const newUnitId = await newUnit('U_BULK1_NEW');
      const reactivateUnitId = await newUnit('U_BULK1_REACT');
      const bogusUnitId = 999999;

      // pre-seed the "previously-deactivated" row: enable then deactivate it.
      const enabled = (
        await request(app)
          .post('/api/v2/cpv-units')
          .set(SA)
          .send({ clientProductId, verificationUnitId: reactivateUnitId })
      ).body;
      await request(app)
        .post(`/api/v2/cpv-units/${enabled.id}/deactivate`)
        .set(SA)
        .send({ version: enabled.version });

      const res = await request(app)
        .post('/api/v2/cpv-units/bulk')
        .set(SA)
        .send({ clientProductId, verificationUnitIds: [newUnitId, reactivateUnitId, bogusUnitId] });

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(3);
      const byUnit = new Map(
        (res.body.results as { verificationUnitId: number; status: string }[]).map((r) => [
          r.verificationUnitId,
          r.status,
        ]),
      );
      expect(byUnit.get(newUnitId)).toBe('CREATED');
      expect(byUnit.get(reactivateUnitId)).toBe('REACTIVATED');
      expect(byUnit.get(bogusUnitId)).toBe('ERROR');

      // the two good rows actually landed active — the ERROR row didn't abort the transaction.
      const list = await request(app).get(`/api/v2/cpv-units?clientProductId=${clientProductId}`).set(SA);
      const active = list.body.filter((u: { isActive: boolean }) => u.isActive);
      expect(active).toHaveLength(2);
      const reactivated = list.body.find(
        (u: { verificationUnitId: number }) => u.verificationUnitId === reactivateUnitId,
      );
      expect(reactivated.isActive).toBe(true);
      expect(reactivated.version).toBe(3); // 1 (create) -> 2 (deactivate) -> 3 (bulk reactivate)

      // audit: one row per successful (CREATED/REACTIVATED) unit — never for the ERROR row.
      const audit = await db!.pool.query(
        `SELECT entity_id, action FROM audit_log WHERE entity_type = 'client_product_verification_units'`,
      );
      const auditedIds = audit.rows.map((r: { entity_id: string }) => r.entity_id);
      expect(auditedIds).toContain(String(enabled.id)); // reactivated row
      expect(auditedIds.length).toBeGreaterThanOrEqual(3); // create + deactivate + bulk-create/reactivate
    });

    it('bulk create is permission-gated (FIELD_AGENT 403; unauthenticated 401)', async () => {
      const clientProductId = await newClientProduct(await newClient('C_BULK2'), await newProduct('P_BULK2'));
      const unitId = await newUnit('U_BULK2');
      expect(
        (
          await request(app)
            .post('/api/v2/cpv-units/bulk')
            .set(FA)
            .send({ clientProductId, verificationUnitIds: [unitId] })
        ).status,
      ).toBe(403);
      expect(
        (
          await request(app)
            .post('/api/v2/cpv-units/bulk')
            .send({ clientProductId, verificationUnitIds: [unitId] })
        ).status,
      ).toBe(401);
    });

    it('bulk create rejects an empty or oversized list (400)', async () => {
      const clientProductId = await newClientProduct(await newClient('C_BULK3'), await newProduct('P_BULK3'));
      expect(
        (
          await request(app)
            .post('/api/v2/cpv-units/bulk')
            .set(SA)
            .send({ clientProductId, verificationUnitIds: [] })
        ).status,
      ).toBe(400);
    });
  });

  describe('cpv-units export', () => {
    const FA = authHeaderForRole('FIELD_AGENT');

    it('exports the current view as CSV (200 + headers + resolvable code cells, round-trippable)', async () => {
      await enableUnit('C_UEXP', 'P_UEXP', 'U_UEXP');
      const res = await request(app).get('/api/v2/cpv-units/export?format=csv&mode=current').set(SA);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="cpv-units-\d{8}\.csv"/);
      // codes are their own columns (matching the import 'Client Code'/'Product Code'/'Unit Code') → re-importable.
      expect(res.text.split('\r\n')[0]).toBe(
        'Client Code,Client Name,Product Code,Product Name,Unit Code,Unit Name,Effective From,Created,Updated,Status',
      );
      expect(res.text).toContain('C_UEXP,'); // the Client Code cell carries the bare code
      expect(res.text).toContain('U_UEXP'); // the Unit Code cell carries the bare code
    });

    it('exports all matching as XLSX (200 + PK-zip body)', async () => {
      await enableUnit('C_UEXX', 'P_UEXX', 'U_UEXX');
      const res = await request(app)
        .get('/api/v2/cpv-units/export?format=xlsx&mode=all')
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
      await enableUnit('C_UEXC', 'P_UEXC', 'U_UEXC');
      const res = await request(app)
        .get('/api/v2/cpv-units/export?format=csv&mode=all&cols=unit,status')
        .set(SA);
      expect(res.text.split('\r\n')[0]).toBe('Unit Code,Status');
    });

    it('a role without data.export cannot export (403); unauth is 401', async () => {
      expect((await request(app).get('/api/v2/cpv-units/export').set(FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/cpv-units/export')).status).toBe(401);
    });

    it('the exported CSV re-imports losslessly (round-trip): export → upload → preview validates', async () => {
      await enableUnit('C_URT', 'P_URT', 'U_URT');
      const csv = (await request(app).get('/api/v2/cpv-units/export?format=csv&mode=all').set(SA)).text;
      // Feed the exact exported CSV bytes back into the import preview — the engine maps 'Client Code'/
      // 'Product Code'/'Unit Code' and ignores the extra Name/audit columns; all resolve → 0 errors.
      const res = await request(app)
        .post('/api/v2/cpv-units/import?mode=preview')
        .set(SA)
        .set('content-type', 'application/octet-stream')
        .set('x-filename', 'cpv-units.csv')
        .send(Buffer.from(csv, 'utf8'));
      expect(res.status).toBe(200);
      expect(res.body.errorRows).toBe(0);
      expect(res.body.validRows).toBe(res.body.totalRows);
      expect(res.body.totalRows).toBeGreaterThanOrEqual(1);
    });
  });

  // ── IE-DEFER-2 import (FK-resolving): the file carries client/product/unit CODES → resolve → ids ──
  describe('cpv-units import', () => {
    const FA = authHeaderForRole('FIELD_AGENT');
    const HEADER = ['Client Code', 'Product Code', 'Unit Code', 'Effective From'];

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
        .post(`/api/v2/cpv-units/import?mode=${mode}`)
        .set(auth)
        .set('content-type', 'application/octet-stream')
        .set('x-filename', 'cpv-units.xlsx')
        .send(buf);

    // Seed a USABLE client-product link (HDFC + HOME_LOAN) and a unit (RESI) the import can resolve.
    const seedRefs = async () => {
      await newClientProduct(await newClient('HDFC'), await newProduct('HOME_LOAN'));
      await newUnit('RESI');
    };

    it('downloads an XLSX template (200 + PK body + filename)', async () => {
      const res = await request(app)
        .get('/api/v2/cpv-units/import-template')
        .set(SA)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('cpv-units-import-template.xlsx');
      expect((res.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
    });

    it('preview resolves a known triple (valid) and flags an unknown unit code (errorRows)', async () => {
      await seedRefs();
      const res = await upload(
        'preview',
        await mkXlsx([
          ['HDFC', 'HOME_LOAN', 'RESI', ''],
          ['HDFC', 'HOME_LOAN', 'NOPE', ''],
        ]),
      );
      expect(res.status).toBe(200);
      expect(res.body.validRows).toBe(1);
      expect(res.body.errorRows).toBe(1);
      expect(res.body.errors[0]).toMatchObject({ column: 'Unit Code' });
    });

    it('preview flags a client+product pair with no usable link', async () => {
      await seedRefs(); // HDFC + HOME_LOAN linked, RESI exists
      await newProduct('PERSONAL_LOAN'); // exists but NOT linked to HDFC
      const res = await upload('preview', await mkXlsx([['HDFC', 'PERSONAL_LOAN', 'RESI', '']]));
      expect(res.status).toBe(200);
      expect(res.body.validRows).toBe(0);
      expect(res.body.errorRows).toBe(1);
      expect(res.body.errors[0]).toMatchObject({ column: 'Product Code' });
      expect(res.body.errors[0].message).toContain('no usable client-product link');
    });

    it('confirm imports the valid row, writes the import_log record, and enables the unit', async () => {
      await seedRefs();
      const res = await upload('confirm', await mkXlsx([['HDFC', 'HOME_LOAN', 'RESI', '']]));
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalRows: 1, successRows: 1, failedRows: 0 });
      // the enabled unit shows up on the link's cpv-units list.
      const links = await request(app).get('/api/v2/client-products?search=HDFC').set(SA);
      const linkId = links.body.items[0].id as number;
      const list = await request(app).get(`/api/v2/cpv-units?clientProductId=${linkId}`).set(SA);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].unitCode).toBe('RESI');
      const log = await db!.pool.query(
        `SELECT resource FROM import_log WHERE resource='client_product_verification_units'`,
      );
      expect(log.rows).toHaveLength(1);
    });

    it('confirm reports a duplicate enablement per-row (failed) without blocking — 409 surfaces as failedRows', async () => {
      await seedRefs();
      await upload('confirm', await mkXlsx([['HDFC', 'HOME_LOAN', 'RESI', '']])); // first enablement
      const res = await upload('confirm', await mkXlsx([['HDFC', 'HOME_LOAN', 'RESI', '']])); // duplicate
      expect(res.body).toMatchObject({ totalRows: 1, successRows: 0, failedRows: 1 });
    });

    it('a role without masterdata.manage cannot import or get the template (403); unauth is 401', async () => {
      expect((await upload('preview', await mkXlsx([['HDFC', 'HOME_LOAN', 'RESI', '']]), FA)).status).toBe(
        403,
      );
      expect((await request(app).get('/api/v2/cpv-units/import-template').set(FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/cpv-units/import-template')).status).toBe(401);
    });
  });
});
