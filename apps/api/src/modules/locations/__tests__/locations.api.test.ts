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
const BE = authHeaderForRole('BACKEND_USER');

const loc = (over: Record<string, unknown> = {}) => ({
  pincode: '400001',
  area: 'Fort',
  city: 'Mumbai',
  state: 'Maharashtra',
  ...over,
});

describe.skipIf(!RUN)('locations API', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    // truncate audit_log too: integer ids restart at 1 each test, so audit rows would
    // otherwise collide on entity_id across tests (OCC audit assertions scope by entity_id).
    await db!.truncate('locations', 'audit_log', 'import_log');
  });

  it('creates a location (201) and lists it', async () => {
    const created = await request(app).post('/api/v2/locations').set(SA).send(loc());
    expect(created.status).toBe(201);
    expect(created.body.pincode).toBe('400001');
    expect(created.body.isActive).toBe(true);

    const list = await request(app).get('/api/v2/locations').set(SA);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.totalCount).toBe(1);
    expect(list.body.sort).toEqual({ sortBy: 'pincode', sortOrder: 'asc' });
  });

  // ── ADR-0020: pincode correctable while unreferenced, locked once a rate uses it ──
  it('corrects the pincode while UNREFERENCED; locks it once a rate references it → 409 PINCODE_LOCKED', async () => {
    const l = (
      await request(app)
        .post('/api/v2/locations')
        .set(SA)
        .send(loc({ pincode: '400055' }))
    ).body;
    const fix = await request(app).put(`/api/v2/locations/${l.id}`).set(SA).send({
      pincode: '400066',
      area: l.area,
      city: l.city,
      state: l.state,
      country: l.country,
      version: l.version,
    });
    expect(fix.status).toBe(200);
    expect(fix.body.pincode).toBe('400066');
    expect(fix.body.version).toBe(2);

    // reference it from a rate → pincode locks
    const clientId = (
      await request(app)
        .post('/api/v2/clients')
        .set(SA)
        .send(clientFactory({ code: 'C_PIN' }))
    ).body.id;
    const productId = (
      await request(app)
        .post('/api/v2/products')
        .set(SA)
        .send(productFactory({ code: 'P_PIN' }))
    ).body.id;
    const verificationUnitId = (
      await request(app)
        .post('/api/v2/verification-units')
        .set(SA)
        .send(verificationUnitFactory({ code: 'U_PIN' }))
    ).body.id;
    await request(app)
      .post('/api/v2/rates')
      .set(SA)
      .send({ clientId, productId, verificationUnitId, locationId: l.id, amount: 50 });

    const blocked = await request(app).put(`/api/v2/locations/${l.id}`).set(SA).send({
      pincode: '400077',
      area: l.area,
      city: l.city,
      state: l.state,
      country: l.country,
      version: fix.body.version,
    });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('PINCODE_LOCKED');
  });

  it('rejects a malformed pincode with 400 VALIDATION', async () => {
    const res = await request(app)
      .post('/api/v2/locations')
      .set(SA)
      .send(loc({ pincode: '12' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION');
  });

  it('duplicate pincode+area → 409', async () => {
    await request(app).post('/api/v2/locations').set(SA).send(loc());
    const dup = await request(app)
      .post('/api/v2/locations')
      .set(SA)
      .send(loc({ city: 'Other' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('LOCATION_EXISTS');
  });

  it('same pincode, different area is allowed', async () => {
    await request(app)
      .post('/api/v2/locations')
      .set(SA)
      .send(loc({ area: 'Fort' }));
    const ok = await request(app)
      .post('/api/v2/locations')
      .set(SA)
      .send(loc({ area: 'Colaba' }));
    expect(ok.status).toBe(201);
  });

  it('update changes area/city/state', async () => {
    const created = (await request(app).post('/api/v2/locations').set(SA).send(loc())).body;
    expect(created.version).toBe(1);
    const upd = await request(app)
      .put(`/api/v2/locations/${created.id}`)
      .set(SA)
      .send({ area: 'Colaba', city: 'Mumbai', state: 'Maharashtra', version: created.version });
    expect(upd.status).toBe(200);
    expect(upd.body.area).toBe('Colaba');
    expect(upd.body.pincode).toBe('400001');
    expect(upd.body.version).toBe(2); // OCC token bumped by exactly 1
  });

  // ── DataGrid server-pagination contract (PAGINATION_AND_LOADING_STANDARDS §1/§4) ──
  it('paginates: page/limit slice the result set and totals are correct', async () => {
    for (const a of ['Aaa', 'Bbb', 'Ccc'])
      await request(app)
        .post('/api/v2/locations')
        .set(SA)
        .send(loc({ area: a }));
    const p1 = await request(app).get('/api/v2/locations?limit=2&page=1&sortBy=area&sortOrder=asc').set(SA);
    expect(p1.body.items.map((l: { area: string }) => l.area)).toEqual(['Aaa', 'Bbb']);
    expect(p1.body.totalCount).toBe(3);
    expect(p1.body.totalPages).toBe(2);
    const p2 = await request(app).get('/api/v2/locations?limit=2&page=2&sortBy=area&sortOrder=asc').set(SA);
    expect(p2.body.items.map((l: { area: string }) => l.area)).toEqual(['Ccc']);
  });

  it('server sorting: sortBy=pincode desc orders by the whitelisted column', async () => {
    await request(app)
      .post('/api/v2/locations')
      .set(SA)
      .send(loc({ pincode: '110001', area: 'Delhi' }));
    await request(app)
      .post('/api/v2/locations')
      .set(SA)
      .send(loc({ pincode: '700001', area: 'Kolkata' }));
    const res = await request(app).get('/api/v2/locations?sortBy=pincode&sortOrder=desc').set(SA);
    expect(res.body.items[0].pincode).toBe('700001');
    expect(res.body.sort).toEqual({ sortBy: 'pincode', sortOrder: 'desc' });
  });

  it('global search filters by pincode/area/city/state and echoes the filter', async () => {
    await request(app).post('/api/v2/locations').set(SA).send(loc());
    await request(app)
      .post('/api/v2/locations')
      .set(SA)
      .send(loc({ pincode: '560001', area: 'Bengaluru', city: 'Bengaluru', state: 'Karnataka' }));
    const res = await request(app).get('/api/v2/locations?search=Karnataka').set(SA);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].pincode).toBe('560001');
    expect(res.body.filters.search).toBe('Karnataka');
  });

  // ── column filters (DATAGRID_STANDARD §6) — trgm-indexed columns (migration 0020) ──
  it('per-column f_state / f_city filter independently and combine with AND', async () => {
    await request(app).post('/api/v2/locations').set(SA).send(loc()); // Fort, Mumbai, Maharashtra
    await request(app)
      .post('/api/v2/locations')
      .set(SA)
      .send(loc({ pincode: '560001', area: 'Bengaluru', city: 'Bengaluru', state: 'Karnataka' }));
    await request(app)
      .post('/api/v2/locations')
      .set(SA)
      .send(loc({ pincode: '411001', area: 'Shivaji Nagar', city: 'Pune', state: 'Maharashtra' }));

    const byState = await request(app).get('/api/v2/locations?f_state=maha').set(SA);
    expect(byState.body.items.map((l: { city: string }) => l.city).sort()).toEqual(['Mumbai', 'Pune']);
    expect(byState.body.filters.f_state).toBe('maha');

    const combined = await request(app).get('/api/v2/locations?f_state=maha&f_city=pune').set(SA);
    expect(combined.body.items.map((l: { pincode: string }) => l.pincode)).toEqual(['411001']);
  });

  it('rejects limit > 500 with 400 LIMIT_TOO_LARGE (gate 41)', async () => {
    const res = await request(app).get('/api/v2/locations?limit=501').set(SA);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LIMIT_TOO_LARGE');
  });

  it('unknown sortBy falls back to the default sort (no SQL injection surface)', async () => {
    await request(app).post('/api/v2/locations').set(SA).send(loc());
    const res = await request(app).get('/api/v2/locations?sortBy=pincode;DROP TABLE locations').set(SA);
    expect(res.status).toBe(200);
    expect(res.body.sort.sortBy).toBe('pincode'); // default, not the injection string
  });

  it('BACKEND_USER cannot create (403) but can read', async () => {
    const create = await request(app).post('/api/v2/locations').set(BE).send(loc());
    expect(create.status).toBe(403);
    expect((await request(app).get('/api/v2/locations').set(BE)).status).toBe(200);
  });

  it('unauthenticated request is 401', async () => {
    expect((await request(app).get('/api/v2/locations')).status).toBe(401);
  });

  it('activate / deactivate toggles is_active (version-guarded, each bumps version)', async () => {
    const created = (await request(app).post('/api/v2/locations').set(SA).send(loc())).body;
    const off = await request(app)
      .post(`/api/v2/locations/${created.id}/deactivate`)
      .set(SA)
      .send({ version: created.version });
    expect(off.body.isActive).toBe(false);
    expect(off.body.version).toBe(2);
    const on = await request(app)
      .post(`/api/v2/locations/${created.id}/activate`)
      .set(SA)
      .send({ version: off.body.version });
    expect(on.body.isActive).toBe(true);
    expect(on.body.version).toBe(3);
  });

  // ── OCC contract (ADR-0019 / CONCURRENCY_AND_EDITING_STANDARD §6) ──
  it('update without a version → 400 VERSION_REQUIRED', async () => {
    const c = (await request(app).post('/api/v2/locations').set(SA).send(loc())).body;
    const res = await request(app)
      .put(`/api/v2/locations/${c.id}`)
      .set(SA)
      .send({ area: 'Colaba', city: 'Mumbai', state: 'Maharashtra' }); // no version
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VERSION_REQUIRED');
  });

  it('update a non-existent id with a version → 404 LOCATION_NOT_FOUND', async () => {
    const res = await request(app)
      .put('/api/v2/locations/999999')
      .set(SA)
      .send({ area: 'A', city: 'C', state: 'S', version: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('LOCATION_NOT_FOUND');
  });

  it('concurrent edit: second writer at a stale version → 409 STALE_UPDATE with current; re-read succeeds', async () => {
    const c = (await request(app).post('/api/v2/locations').set(SA).send(loc())).body;
    // writer A saves first (v1 → v2)
    const a = await request(app)
      .put(`/api/v2/locations/${c.id}`)
      .set(SA)
      .send({ area: 'A-edit', city: 'Mumbai', state: 'Maharashtra', version: 1 });
    expect(a.status).toBe(200);
    expect(a.body.version).toBe(2);
    // writer B still holds v1 → conflict
    const b = await request(app)
      .put(`/api/v2/locations/${c.id}`)
      .set(SA)
      .send({ area: 'B-edit', city: 'Mumbai', state: 'Maharashtra', version: 1 });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe('STALE_UPDATE');
    expect(b.body.current.version).toBe(2);
    expect(b.body.current.area).toBe('A-edit');
    // B reloads to v2 and re-applies → succeeds
    const b2 = await request(app)
      .put(`/api/v2/locations/${c.id}`)
      .set(SA)
      .send({ area: 'B-edit', city: 'Mumbai', state: 'Maharashtra', version: b.body.current.version });
    expect(b2.status).toBe(200);
    expect(b2.body.version).toBe(3);
    expect(b2.body.area).toBe('B-edit');
  });

  it('every create/update appends exactly one immutable audit_log row (actor + action)', async () => {
    const c = (await request(app).post('/api/v2/locations').set(SA).send(loc())).body;
    await request(app)
      .put(`/api/v2/locations/${c.id}`)
      .set(SA)
      .send({ area: 'Changed', city: 'Mumbai', state: 'Maharashtra', version: c.version });
    const { rows } = await db!.pool.query(
      `SELECT action, version_after FROM audit_log
       WHERE entity_type = 'locations' AND entity_id = $1 ORDER BY id`,
      [String(c.id)],
    );
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
    expect(rows[1].version_after).toBe(2);
    // audit_log is append-only — a direct UPDATE is rejected at the DB
    await expect(
      db!.pool.query(`UPDATE audit_log SET action = 'X' WHERE entity_id = $1`, [String(c.id)]),
    ).rejects.toThrow();
  });

  // ── multi-area create (v1 parity: add a pincode WITH its areas in one action) ──
  describe('batch create', () => {
    const FA = authHeaderForRole('FIELD_AGENT');

    it('creates one row per area under a shared pincode/city/state (201)', async () => {
      const res = await request(app)
        .post('/api/v2/locations/batch')
        .set(SA)
        .send({
          pincode: '400001',
          city: 'Mumbai',
          state: 'Maharashtra',
          areas: ['Fort', 'Colaba', 'Worli'],
        });
      expect(res.status).toBe(201);
      expect(res.body.created).toHaveLength(3);
      expect(res.body.skipped).toHaveLength(0);
      // every row shares the same pincode/city/state — no per-area drift
      expect(
        res.body.created.every(
          (l: { pincode: string; city: string }) => l.pincode === '400001' && l.city === 'Mumbai',
        ),
      ).toBe(true);
      expect((await request(app).get('/api/v2/locations').set(SA)).body.totalCount).toBe(3);
    });

    it('de-dupes areas within the request (case-insensitive) and reports them skipped', async () => {
      const res = await request(app)
        .post('/api/v2/locations/batch')
        .set(SA)
        .send({ pincode: '400001', city: 'Mumbai', state: 'Maharashtra', areas: ['Fort', 'fort', 'Colaba'] });
      expect(res.status).toBe(201);
      expect(res.body.created.map((l: { area: string }) => l.area)).toEqual(['Fort', 'Colaba']);
      expect(res.body.skipped).toHaveLength(1);
      expect(res.body.skipped[0]).toMatchObject({ area: 'fort', reason: 'duplicate in request' });
    });

    it('skips an area whose (pincode,area) already exists, without aborting the rest', async () => {
      await request(app)
        .post('/api/v2/locations')
        .set(SA)
        .send(loc({ area: 'Fort' })); // pre-existing
      const res = await request(app)
        .post('/api/v2/locations/batch')
        .set(SA)
        .send({ pincode: '400001', city: 'Mumbai', state: 'Maharashtra', areas: ['Fort', 'Colaba'] });
      expect(res.status).toBe(201);
      expect(res.body.created.map((l: { area: string }) => l.area)).toEqual(['Colaba']);
      expect(res.body.skipped[0]).toMatchObject({ area: 'Fort', reason: 'pincode+area already exists' });
      expect((await request(app).get('/api/v2/locations').set(SA)).body.totalCount).toBe(2);
    });

    it('empty areas → 400 VALIDATION', async () => {
      const res = await request(app)
        .post('/api/v2/locations/batch')
        .set(SA)
        .send({ pincode: '400001', city: 'Mumbai', state: 'Maharashtra', areas: [] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('VALIDATION');
    });

    it('a role without masterdata.manage cannot batch-create (403); unauth is 401', async () => {
      const body = { pincode: '400001', city: 'Mumbai', state: 'Maharashtra', areas: ['Fort'] };
      expect((await request(app).post('/api/v2/locations/batch').set(FA).send(body)).status).toBe(403);
      expect((await request(app).post('/api/v2/locations/batch').send(body)).status).toBe(401);
    });
  });

  // ── B-13 DataGrid export (IMPORT_EXPORT_STANDARD) ──
  describe('export', () => {
    const FA = authHeaderForRole('FIELD_AGENT');

    it('exports the current view as CSV (200 + headers + rows)', async () => {
      await request(app)
        .post('/api/v2/locations')
        .set(SA)
        .send(loc({ pincode: '400001', area: 'Fort', city: 'Mumbai', state: 'Maharashtra' }));
      const res = await request(app).get('/api/v2/locations/export?format=csv&mode=current').set(SA);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="locations-\d{8}\.csv"/);
      expect(res.text.split('\r\n')[0]).toBe(
        'Pincode,Area,City,State,Country,Effective From,Created,Updated,Status',
      );
      expect(res.text).toContain('400001,Fort,Mumbai,Maharashtra');
    });

    it('exports all matching as XLSX (200 + PK-zip body)', async () => {
      await request(app)
        .post('/api/v2/locations')
        .set(SA)
        .send(loc({ pincode: '400002', area: 'Colaba' }));
      const res = await request(app)
        .get('/api/v2/locations/export?format=xlsx&mode=all')
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
      await request(app)
        .post('/api/v2/locations')
        .set(SA)
        .send(loc({ pincode: '400003', area: 'Worli' }));
      const res = await request(app)
        .get('/api/v2/locations/export?format=csv&mode=all&cols=pincode,status')
        .set(SA);
      expect(res.text.split('\r\n')[0]).toBe('Pincode,Status');
    });

    it('mode=selected exports only the ticked ids (not the whole list)', async () => {
      const a = (
        await request(app)
          .post('/api/v2/locations')
          .set(SA)
          .send(loc({ pincode: '411001', area: 'SelA' }))
      ).body as { id: number };
      await request(app)
        .post('/api/v2/locations')
        .set(SA)
        .send(loc({ pincode: '411002', area: 'SelB' }));
      const res = await request(app)
        .get(`/api/v2/locations/export?format=csv&mode=selected&ids=${a.id}`)
        .set(SA);
      expect(res.status).toBe(200);
      expect(res.text.split('\r\n')[0]).toBe(
        'Pincode,Area,City,State,Country,Effective From,Created,Updated,Status',
      );
      expect(res.text).toContain('411001,SelA');
      expect(res.text).not.toContain('411002,SelB'); // the unticked row is excluded
    });

    it('mode=selected with no ids exports nothing (never falls through to all)', async () => {
      await request(app)
        .post('/api/v2/locations')
        .set(SA)
        .send(loc({ pincode: '411003', area: 'NoIds' }));
      const res = await request(app).get('/api/v2/locations/export?format=csv&mode=selected').set(SA);
      expect(res.status).toBe(200);
      expect(res.text.split('\r\n')).toHaveLength(1); // header only, zero data rows
    });

    it('rejects an unknown format with 400', async () => {
      const res = await request(app).get('/api/v2/locations/export?format=pdf').set(SA);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_EXPORT_FORMAT');
    });

    it('a role without data.export cannot export (403)', async () => {
      expect((await request(app).get('/api/v2/locations/export').set(FA)).status).toBe(403);
    });

    it('unauthenticated export is 401', async () => {
      expect((await request(app).get('/api/v2/locations/export')).status).toBe(401);
    });

    it('BACKEND_USER (has data.export) can export (200)', async () => {
      expect((await request(app).get('/api/v2/locations/export?format=csv').set(BE)).status).toBe(200);
    });
  });

  // ── bulk activate/deactivate (per-row OCC, CONCURRENCY_AND_EDITING_STANDARD §1) ──
  describe('bulk', () => {
    const FA = authHeaderForRole('FIELD_AGENT');
    const mk = async (pincode: string) =>
      (await request(app).post('/api/v2/locations').set(SA).send(loc({ pincode }))).body as {
        id: number;
        version: number;
      };

    it('bulk-deactivate applies per-row and reports all OK', async () => {
      const a = await mk('400101');
      const b = await mk('400102');
      const res = await request(app)
        .post('/api/v2/locations/bulk-deactivate')
        .set(SA)
        .send({
          items: [
            { id: a.id, version: a.version },
            { id: b.id, version: b.version },
          ],
        });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ okCount: 2, conflictCount: 0, notFoundCount: 0 });
      // locations has no GET /:id → verify via the active=false list
      const inactive = (await request(app).get('/api/v2/locations?active=false&limit=100').set(SA)).body
        .items as { id: number; isActive: boolean }[];
      expect(inactive.some((l) => l.id === a.id && !l.isActive)).toBe(true);
    });

    it('mixed batch → per-row OK / CONFLICT (stale version) / NOT_FOUND, no silent overwrite', async () => {
      const ok = await mk('400201');
      const stale = await mk('400202');
      // bump `stale` so the version the batch carries is now behind
      await request(app)
        .post(`/api/v2/locations/${stale.id}/deactivate`)
        .set(SA)
        .send({ version: stale.version });
      const res = await request(app)
        .post('/api/v2/locations/bulk-deactivate')
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
      const res = await request(app).post('/api/v2/locations/bulk-activate').set(SA).send({ items: [] });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BULK_ITEMS_REQUIRED');
    });

    it('a role without masterdata.manage cannot bulk-mutate (403); unauth is 401', async () => {
      expect(
        (await request(app).post('/api/v2/locations/bulk-deactivate').set(FA).send({ items: [] })).status,
      ).toBe(403);
      expect((await request(app).post('/api/v2/locations/bulk-deactivate').send({ items: [] })).status).toBe(
        401,
      );
    });
  });

  // ── B-14 universal import engine (IMPORT_EXPORT_STANDARD §5/§6/§7/§8) — FK-free pincode catalog ──
  describe('import', () => {
    const FA = authHeaderForRole('FIELD_AGENT');
    const HEADER = ['Pincode', 'Area', 'City', 'State', 'Country', 'Effective From'];

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
        .post(`/api/v2/locations/import?mode=${mode}`)
        .set(auth)
        .set('content-type', 'application/octet-stream')
        .set('x-filename', 'locations.xlsx')
        .send(buf);

    it('downloads an XLSX template (200 + PK body + filename)', async () => {
      const res = await request(app)
        .get('/api/v2/locations/import-template')
        .set(SA)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('locations-import-template.xlsx');
      expect((res.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
    });

    it('preview flags an invalid row (bad pincode) against the file column, keeps the valid one', async () => {
      const res = await upload(
        'preview',
        await mkXlsx([
          ['400001', 'Fort', 'Mumbai', 'Maharashtra', 'India'],
          ['abc', 'Bad', 'Nowhere', 'Nowhere', 'India'],
        ]),
      );
      expect(res.status).toBe(200);
      expect(res.body.validRows).toBe(1);
      expect(res.body.errorRows).toBe(1);
      expect(res.body.errors[0]).toMatchObject({ rowNumber: 3, column: 'Pincode' });
      // preview is read-only — nothing inserted
      expect((await request(app).get('/api/v2/locations').set(SA)).body.totalCount).toBe(0);
    });

    it('confirm imports valid rows, writes the import_log audit record, and audits each create', async () => {
      const res = await upload(
        'confirm',
        await mkXlsx([
          ['400001', 'Fort', 'Mumbai', 'Maharashtra', 'India'],
          ['560001', 'Bengaluru', 'Bengaluru', 'Karnataka', 'India'],
        ]),
      );
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ totalRows: 2, successRows: 2, failedRows: 0 });
      // rows persisted
      expect((await request(app).get('/api/v2/locations').set(SA)).body.totalCount).toBe(2);
      // import_log batch record (§7)
      const log = await db!.pool.query(
        `SELECT resource, file_name, total_rows, success_rows, failed_rows FROM import_log`,
      );
      expect(log.rows).toHaveLength(1);
      expect(log.rows[0]).toMatchObject({
        resource: 'locations',
        file_name: 'locations.xlsx',
        total_rows: 2,
        success_rows: 2,
        failed_rows: 0,
      });
    });

    it('a role without masterdata.manage cannot import or get the template (403); unauth is 401', async () => {
      const buf = await mkXlsx([['400001', 'Fort', 'Mumbai', 'Maharashtra', 'India']]);
      expect((await upload('preview', buf, FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/locations/import-template').set(FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/locations/import-template')).status).toBe(401);
    });
  });
});
