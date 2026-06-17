import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, productFactory, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BE = authHeaderForRole('BACKEND_USER');

describe.skipIf(!RUN)('products API', () => {
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
    await db!.truncate('products', 'audit_log', 'import_log');
  });

  it('SUPER_ADMIN creates a product (201) and lists it', async () => {
    const created = await request(app)
      .post('/api/v2/products')
      .set(SA)
      .send(productFactory({ code: 'HOME_LOAN' }));
    expect(created.status).toBe(201);
    expect(created.body.code).toBe('HOME_LOAN');
    expect(created.body.isActive).toBe(true);

    const list = await request(app).get('/api/v2/products').set(SA);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.totalCount).toBe(1);
    expect(list.body.pageSize).toBe(25);
  });

  it('rejects limit > 500 with 400 LIMIT_TOO_LARGE (gate 41)', async () => {
    const res = await request(app).get('/api/v2/products?limit=501').set(SA);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('LIMIT_TOO_LARGE');
  });

  it('rejects an empty name with 400 VALIDATION', async () => {
    const res = await request(app).post('/api/v2/products').set(SA).send({ code: 'HOME_LOAN', name: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION');
  });

  it('BACKEND_USER cannot create (403) but can read', async () => {
    const create = await request(app).post('/api/v2/products').set(BE).send(productFactory());
    expect(create.status).toBe(403);
    const read = await request(app).get('/api/v2/products').set(BE);
    expect(read.status).toBe(200);
  });

  it('unauthenticated request is 401', async () => {
    expect((await request(app).get('/api/v2/products')).status).toBe(401);
  });

  it('duplicate code → 409', async () => {
    await request(app)
      .post('/api/v2/products')
      .set(SA)
      .send(productFactory({ code: 'AUTO_LOAN' }));
    const dup = await request(app)
      .post('/api/v2/products')
      .set(SA)
      .send(productFactory({ code: 'AUTO_LOAN' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('PRODUCT_CODE_EXISTS');
  });

  it('update changes the name, code stays immutable', async () => {
    const created = (
      await request(app)
        .post('/api/v2/products')
        .set(SA)
        .send(productFactory({ code: 'PL' }))
    ).body;
    expect(created.version).toBe(1);
    const upd = await request(app)
      .put(`/api/v2/products/${created.id}`)
      .set(SA)
      .send({ name: 'Personal Loan v2', version: created.version });
    expect(upd.status).toBe(200);
    expect(upd.body.name).toBe('Personal Loan v2');
    expect(upd.body.code).toBe('PL');
    expect(upd.body.version).toBe(2); // OCC token bumped by exactly 1
  });

  it('activate / deactivate toggles is_active (version-guarded, each bumps version)', async () => {
    const created = (
      await request(app)
        .post('/api/v2/products')
        .set(SA)
        .send(productFactory({ code: 'CC' }))
    ).body;
    const off = await request(app)
      .post(`/api/v2/products/${created.id}/deactivate`)
      .set(SA)
      .send({ version: created.version });
    expect(off.body.isActive).toBe(false);
    expect(off.body.version).toBe(2);
    const on = await request(app)
      .post(`/api/v2/products/${created.id}/activate`)
      .set(SA)
      .send({ version: off.body.version });
    expect(on.body.isActive).toBe(true);
    expect(on.body.version).toBe(3);
  });

  it('404 for unknown id', async () => {
    expect((await request(app).get('/api/v2/products/999999').set(SA)).status).toBe(404);
  });

  // ── ADR-0020: code correctable while unreferenced, locked once in use ──
  it('corrects the code while UNREFERENCED; locks it once REFERENCED → 409 CODE_LOCKED', async () => {
    const p = (await request(app).post('/api/v2/products').set(SA).send({ code: 'HOEM', name: 'Home Loan' }))
      .body;
    const fix = await request(app)
      .put(`/api/v2/products/${p.id}`)
      .set(SA)
      .send({ code: 'HOME', name: 'Home Loan', version: p.version });
    expect(fix.status).toBe(200);
    expect(fix.body.code).toBe('HOME');

    const c = (await request(app).post('/api/v2/clients').set(SA).send({ code: 'C_PL', name: 'C' })).body;
    await request(app).post('/api/v2/client-products').set(SA).send({ clientId: c.id, productId: p.id });
    const blocked = await request(app)
      .put(`/api/v2/products/${p.id}`)
      .set(SA)
      .send({ code: 'HOME2', name: 'Home Loan', version: fix.body.version });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toBe('CODE_LOCKED');
  });

  // ── B-22 options endpoint (unpaginated USABLE feed for dropdowns) ──
  it('GET /options returns USABLE products only as a flat {id,code,name} array (B-22)', async () => {
    await request(app).post('/api/v2/products').set(SA).send({ code: 'HOME', name: 'Home Loan' });
    const off = (
      await request(app).post('/api/v2/products').set(SA).send({ code: 'OFFP', name: 'Off Product' })
    ).body;
    await request(app).post(`/api/v2/products/${off.id}/deactivate`).set(SA).send({ version: off.version });
    const future = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    await request(app)
      .post('/api/v2/products')
      .set(SA)
      .send({ code: 'FUTP', name: 'Future', effectiveFrom: future });

    const res = await request(app).get('/api/v2/products/options').set(SA);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true); // flat array, NOT a pagination envelope
    const codes = res.body.map((o: { code: string }) => o.code);
    expect(codes).toContain('HOME');
    expect(codes).not.toContain('OFFP'); // inactive excluded
    expect(codes).not.toContain('FUTP'); // future-dated excluded (ADR-0017)
    expect(Object.keys(res.body[0]).sort()).toEqual(['code', 'id', 'name']); // trimmed shape
  });

  it('GET /options requires auth (401); BACKEND_USER may read (200)', async () => {
    expect((await request(app).get('/api/v2/products/options')).status).toBe(401);
    expect((await request(app).get('/api/v2/products/options').set(BE)).status).toBe(200);
  });

  // ── B2: /options is scoped to the actor's PRODUCT portfolio (commit 3b00776 part E) ──
  it('GET /options is scoped to the actor portfolio: a BACKEND_USER sees only assigned products, SUPER_ADMIN sees all', async () => {
    const hdr = (role: string, id: string): Record<string, string> => ({ 'x-test-auth': `${role}:${id}` });
    const createUser = async (username: string): Promise<string> =>
      (
        await request(app)
          .post('/api/v2/users')
          .set(SA)
          .send({ username, name: username.toUpperCase(), role: 'BACKEND_USER' })
      ).body.id as string;
    const mk = async (code: string): Promise<number> =>
      (await request(app).post('/api/v2/products').set(SA).send(productFactory({ code }))).body.id as number;

    const a = await mk('PRA');
    await mk('PRB');
    await mk('PRC');

    // BACKEND_USER holds PRODUCT as a RESTRICT dimension (mig 0049) → an assignment narrows /options
    // to it, and NO assignment is fail-closed (empty), since a backend user is always given a product.
    const bePortfolio = await createUser('be_popts_p');
    await request(app)
      .post(`/api/v2/users/${bePortfolio}/scope-assignments`)
      .set(SA)
      .send({ dimension: 'PRODUCT', entityIds: [a] });
    const beNone = await createUser('be_popts_none');

    const saCodes = (await request(app).get('/api/v2/products/options').set(SA)).body
      .map((o: { code: string }) => o.code)
      .sort();
    expect(saCodes).toEqual(['PRA', 'PRB', 'PRC']);

    const portfolioCodes = (
      await request(app).get('/api/v2/products/options').set(hdr('BACKEND_USER', bePortfolio))
    ).body.map((o: { code: string }) => o.code);
    expect(portfolioCodes).toEqual(['PRA']);

    // PRODUCT is a RESTRICT cap for BACKEND_USER (mig 0049): no assignment is fail-closed → /options
    // is empty (never the full catalog), matching the cases/tasks portfolio scoping.
    const noneCodes = (
      await request(app).get('/api/v2/products/options').set(hdr('BACKEND_USER', beNone))
    ).body.map((o: { code: string }) => o.code);
    expect(noneCodes).toEqual([]);
  });

  // ── OCC contract (ADR-0019 / CONCURRENCY_AND_EDITING_STANDARD §6) ──
  it('update without a version → 400 VERSION_REQUIRED', async () => {
    const p = (
      await request(app)
        .post('/api/v2/products')
        .set(SA)
        .send(productFactory({ code: 'NEEDVER' }))
    ).body;
    const res = await request(app).put(`/api/v2/products/${p.id}`).set(SA).send({ name: 'X' }); // no version
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VERSION_REQUIRED');
  });

  it('update a non-existent id with a version → 404 PRODUCT_NOT_FOUND', async () => {
    const res = await request(app).put('/api/v2/products/999999').set(SA).send({ name: 'X', version: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('PRODUCT_NOT_FOUND');
  });

  it('concurrent edit: second writer at a stale version → 409 STALE_UPDATE with current; re-read succeeds', async () => {
    const p = (
      await request(app)
        .post('/api/v2/products')
        .set(SA)
        .send(productFactory({ code: 'RACE' }))
    ).body;
    // writer A saves first (v1 → v2)
    const a = await request(app).put(`/api/v2/products/${p.id}`).set(SA).send({ name: 'A-edit', version: 1 });
    expect(a.status).toBe(200);
    expect(a.body.version).toBe(2);
    // writer B still holds v1 → conflict
    const b = await request(app).put(`/api/v2/products/${p.id}`).set(SA).send({ name: 'B-edit', version: 1 });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe('STALE_UPDATE');
    expect(b.body.current.version).toBe(2);
    expect(b.body.current.name).toBe('A-edit');
    // B reloads to v2 and re-applies → succeeds
    const b2 = await request(app)
      .put(`/api/v2/products/${p.id}`)
      .set(SA)
      .send({ name: 'B-edit', version: b.body.current.version });
    expect(b2.status).toBe(200);
    expect(b2.body.version).toBe(3);
    expect(b2.body.name).toBe('B-edit');
  });

  it('every create/update appends exactly one immutable audit_log row (actor + action)', async () => {
    const p = (
      await request(app)
        .post('/api/v2/products')
        .set(SA)
        .send(productFactory({ code: 'AUDITED' }))
    ).body;
    await request(app).put(`/api/v2/products/${p.id}`).set(SA).send({ name: 'Changed', version: p.version });
    const { rows } = await db!.pool.query(
      `SELECT action, version_after FROM audit_log
       WHERE entity_type = 'products' AND entity_id = $1 ORDER BY id`,
      [String(p.id)],
    );
    expect(rows.map((r) => r.action)).toEqual(['CREATE', 'UPDATE']);
    expect(rows[1].version_after).toBe(2);
    // audit_log is append-only — a direct UPDATE is rejected at the DB
    await expect(
      db!.pool.query(`UPDATE audit_log SET action = 'X' WHERE entity_id = $1`, [String(p.id)]),
    ).rejects.toThrow();
  });

  // ── B-14 import (engine fully covered by clients; this proves the products wiring) ──
  describe('import', () => {
    const FA = authHeaderForRole('FIELD_AGENT');
    const mkXlsx = async (rows: (string | number)[][]): Promise<Buffer> => {
      const ExcelJS = (await import('exceljs')).default;
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet('Sheet1');
      ws.addRow(['Code', 'Name', 'Effective From']);
      for (const r of rows) ws.addRow(r);
      return Buffer.from(await wb.xlsx.writeBuffer());
    };
    const upload = (mode: 'preview' | 'confirm', buf: Buffer, auth = SA) =>
      request(app)
        .post(`/api/v2/products/import?mode=${mode}`)
        .set(auth)
        .set('content-type', 'application/octet-stream')
        .set('x-filename', 'products.xlsx')
        .send(buf);

    it('template downloads, preview validates, confirm imports + writes import_log', async () => {
      const tpl = await request(app).get('/api/v2/products/import-template').set(SA);
      expect(tpl.status).toBe(200);
      expect(tpl.headers['content-disposition']).toContain('products-import-template.xlsx');

      const prev = await upload(
        'preview',
        await mkXlsx([
          ['HOME_LOAN', 'Home Loan'],
          ['bad', 'x'],
        ]),
      );
      expect(prev.body).toMatchObject({ totalRows: 2, validRows: 1, errorRows: 1 });

      const conf = await upload(
        'confirm',
        await mkXlsx([
          ['HOME_LOAN', 'Home Loan'],
          ['AUTO_LOAN', 'Auto'],
        ]),
      );
      expect(conf.body).toMatchObject({ totalRows: 2, successRows: 2, failedRows: 0 });
      expect((await request(app).get('/api/v2/products').set(SA)).body.totalCount).toBe(2);
      const log = await db!.pool.query(`SELECT resource, total_rows, success_rows FROM import_log`);
      expect(log.rows[0]).toMatchObject({ resource: 'products', total_rows: 2, success_rows: 2 });
    });

    it('a role without masterdata.manage cannot import (403); unauth is 401', async () => {
      expect((await upload('preview', await mkXlsx([['X', 'X']]), FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/products/import-template')).status).toBe(401);
    });
  });
});
