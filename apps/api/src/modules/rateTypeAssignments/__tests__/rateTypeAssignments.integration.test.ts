import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import {
  createTestDb,
  authHeaderForRole,
  clientFactory,
  productFactory,
  verificationUnitFactory,
} from '@crm2/test-utils';
import type { RateTypeAssignmentView } from '@crm2/sdk';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const FA = authHeaderForRole('FIELD_AGENT'); // holds neither masterdata perm
const TL = authHeaderForRole('TEAM_LEADER'); // holds data.export but NOT masterdata.manage

const seedId = async (path: string, body: object): Promise<number> => {
  const res = await request(app).post(`/api/v2/${path}`).set(SA).send(body);
  expect(res.status).toBe(201);
  return res.body.id as number;
};

describe.skipIf(!RUN)('rate-type assignments CRUD (ADR-0069)', () => {
  let clientId: number;
  let productId: number;
  let unitId: number;
  let clientCode: string;
  let productCode: string;
  let unitCode: string;
  let rtA: number;
  let rtCodeA: string;

  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate('rate_type_assignments', 'verification_units', 'products', 'clients', 'audit_log');
    clientCode = 'RTA_CLIENT';
    productCode = 'RTA_PRODUCT';
    unitCode = 'RTA_UNIT';
    clientId = await seedId('clients', clientFactory({ code: clientCode }));
    productId = await seedId('products', productFactory({ code: productCode }));
    unitId = await seedId('verification-units', verificationUnitFactory({ code: unitCode }));
    const rts = await db!.pool.query<{ id: number; code: string }>(
      `SELECT id, code FROM rate_types WHERE is_active AND effective_from <= now() ORDER BY sort_order LIMIT 1`,
    );
    rtA = rts.rows[0]!.id;
    rtCodeA = rts.rows[0]!.code;
  });

  it('creates a fully-specified assignment (201) and lists the joined view (paginated)', async () => {
    const created = await request(app)
      .post('/api/v2/rate-type-assignments')
      .set(SA)
      .send({ clientId, productId, verificationUnitId: unitId, rateTypeId: rtA });
    expect(created.status).toBe(201);
    expect(created.body.clientId).toBe(clientId);
    expect(created.body.rateTypeId).toBe(rtA);
    expect(created.body.isActive).toBe(true);
    expect(created.body.rateTypeCode).toBeTypeOf('string');

    const list = await request(app).get('/api/v2/rate-type-assignments').set(SA);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    const row = list.body.items[0] as RateTypeAssignmentView;
    expect(row.clientName).toBeTruthy();
    expect(row.productName).toBeTruthy();
    expect(row.verificationUnitName).toBeTruthy();
    expect(list.body.sort).toEqual({ sortBy: 'client', sortOrder: 'asc' });
  });

  it('creates a Universal assignment (product + unit NULL) — list shows nulls', async () => {
    const created = await request(app)
      .post('/api/v2/rate-type-assignments')
      .set(SA)
      .send({ clientId, productId: null, verificationUnitId: null, rateTypeId: rtA });
    expect(created.status).toBe(201);
    expect(created.body.productId).toBeNull();
    expect(created.body.verificationUnitId).toBeNull();

    const list = await request(app).get('/api/v2/rate-type-assignments').set(SA);
    const row = list.body.items[0] as RateTypeAssignmentView;
    expect(row.productId).toBeNull();
    expect(row.verificationUnitId).toBeNull();
    expect(row.productName).toBeNull();
    expect(row.verificationUnitName).toBeNull();
  });

  it('NULLS-NOT-DISTINCT: creating the same combo twice re-activates, does not duplicate', async () => {
    const first = await request(app)
      .post('/api/v2/rate-type-assignments')
      .set(SA)
      .send({ clientId, productId: null, verificationUnitId: null, rateTypeId: rtA });
    expect(first.status).toBe(201);
    // Deactivate, then re-create the SAME combo → re-activates the same row (no dup).
    await request(app).post(`/api/v2/rate-type-assignments/${first.body.id}/deactivate`).set(SA);
    const second = await request(app)
      .post('/api/v2/rate-type-assignments')
      .set(SA)
      .send({ clientId, productId: null, verificationUnitId: null, rateTypeId: rtA });
    expect(second.status).toBe(201);
    expect(second.body.id).toBe(first.body.id); // same row reactivated
    expect(second.body.isActive).toBe(true);

    const rows = await db!.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM rate_type_assignments WHERE client_id = $1 AND rate_type_id = $2`,
      [clientId, rtA],
    );
    expect(rows.rows[0]!.n).toBe(1); // exactly one row, never duplicated
  });

  it('a Universal row and a specific row for the same client+rateType coexist', async () => {
    const uni = await request(app)
      .post('/api/v2/rate-type-assignments')
      .set(SA)
      .send({ clientId, productId: null, verificationUnitId: null, rateTypeId: rtA });
    expect(uni.status).toBe(201);
    const specific = await request(app)
      .post('/api/v2/rate-type-assignments')
      .set(SA)
      .send({ clientId, productId, verificationUnitId: unitId, rateTypeId: rtA });
    expect(specific.status).toBe(201);
    expect(specific.body.id).not.toBe(uni.body.id);
    const list = await request(app).get('/api/v2/rate-type-assignments').set(SA);
    expect(list.body.totalCount).toBe(2);
  });

  describe('GET /:id (record-page loader)', () => {
    it('returns the joined view for a created assignment (200)', async () => {
      const created = await request(app)
        .post('/api/v2/rate-type-assignments')
        .set(SA)
        .send({ clientId, productId, verificationUnitId: unitId, rateTypeId: rtA });
      const id = created.body.id as number;
      const res = await request(app).get(`/api/v2/rate-type-assignments/${id}`).set(SA);
      expect(res.status).toBe(200);
      const row = res.body as RateTypeAssignmentView;
      expect(row.id).toBe(id);
      expect(row.clientName).toBeTruthy();
      expect(row.productCode).toBeTruthy();
      expect(row.rateTypeCode).toBeTruthy();
    });
    it('404s an unknown id', async () => {
      const res = await request(app).get('/api/v2/rate-type-assignments/999999').set(SA);
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('RATE_TYPE_ASSIGNMENT_NOT_FOUND');
    });
  });

  it('deactivate sets is_active=false (and is gone from /rate-types/available)', async () => {
    const created = await request(app)
      .post('/api/v2/rate-type-assignments')
      .set(SA)
      .send({ clientId, productId, verificationUnitId: unitId, rateTypeId: rtA });
    const id = created.body.id as number;
    const off = await request(app).post(`/api/v2/rate-type-assignments/${id}/deactivate`).set(SA);
    expect(off.status).toBe(200);
    expect(off.body.isActive).toBe(false);
    // 404 on an unknown id
    expect((await request(app).post('/api/v2/rate-type-assignments/999999/deactivate').set(SA)).status).toBe(
      404,
    );
    // the available resolver no longer lists it
    const avail = await request(app)
      .get(
        `/api/v2/rate-types/available?clientId=${clientId}&productId=${productId}&verificationUnitId=${unitId}`,
      )
      .set(SA);
    expect((avail.body as { id: number }[]).map((r) => r.id)).not.toContain(rtA);
  });

  it('deactivate writes an audit_log row (entity_type=rate_type_assignments, action=DEACTIVATE)', async () => {
    const created = await request(app)
      .post('/api/v2/rate-type-assignments')
      .set(SA)
      .send({ clientId, productId, verificationUnitId: unitId, rateTypeId: rtA });
    const id = created.body.id as number;
    await request(app).post(`/api/v2/rate-type-assignments/${id}/deactivate`).set(SA);
    const rows = await db!.pool.query<{ entity_type: string; entity_id: string; action: string }>(
      `SELECT entity_type, entity_id, action FROM audit_log WHERE entity_type = 'rate_type_assignments' AND entity_id = $1`,
      [String(id)],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]).toMatchObject({ action: 'DEACTIVATE', entity_id: String(id) });
  });

  // ── bulk deactivate (UX-11) — RTA has no version column, so no per-row OCC; mirrors the SHAPE of
  // rates' bulk endpoint (per-row result map), not its version mechanics. Statuses: OK | NOT_FOUND.
  describe('bulk-deactivate', () => {
    it('2 real + 1 missing id → 200 with 2 OK + 1 NOT_FOUND; rows go inactive', async () => {
      const a = await request(app)
        .post('/api/v2/rate-type-assignments')
        .set(SA)
        .send({ clientId, productId, verificationUnitId: unitId, rateTypeId: rtA });
      const b = await request(app)
        .post('/api/v2/rate-type-assignments')
        .set(SA)
        .send({ clientId, productId: null, verificationUnitId: null, rateTypeId: rtA });
      const res = await request(app)
        .post('/api/v2/rate-type-assignments/bulk-deactivate')
        .set(SA)
        // 999999 sent twice — ids are deduped at the boundary, so ONE NOT_FOUND row, not two.
        .send({ ids: [a.body.id, b.body.id, 999999, 999999] });
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ okCount: 2, notFoundCount: 1 });
      expect(res.body.results).toHaveLength(3);
      const byId = Object.fromEntries(
        (res.body.results as { id: string; status: string }[]).map((r) => [r.id, r.status]),
      );
      expect(byId[String(a.body.id)]).toBe('OK');
      expect(byId[String(b.body.id)]).toBe('OK');
      expect(byId['999999']).toBe('NOT_FOUND');

      const getA = await request(app).get(`/api/v2/rate-type-assignments/${a.body.id}`).set(SA);
      const getB = await request(app).get(`/api/v2/rate-type-assignments/${b.body.id}`).set(SA);
      expect(getA.body.isActive).toBe(false);
      expect(getB.body.isActive).toBe(false);

      // audit: one DEACTIVATE row per OK id, none for the NOT_FOUND id.
      const audit = await db!.pool.query<{ entity_id: string; action: string }>(
        `SELECT entity_id, action FROM audit_log WHERE entity_type = 'rate_type_assignments' ORDER BY entity_id`,
      );
      expect(audit.rows).toHaveLength(2);
      const auditIds = audit.rows.map((r) => r.entity_id).sort();
      expect(auditIds).toEqual([String(a.body.id), String(b.body.id)].sort());
      expect(audit.rows.every((r) => r.action === 'DEACTIVATE')).toBe(true);
    });

    it('empty ids → 400 BULK_ITEMS_REQUIRED', async () => {
      const res = await request(app).post('/api/v2/rate-type-assignments/bulk-deactivate').set(SA).send({
        ids: [],
      });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BULK_ITEMS_REQUIRED');
    });

    it('requires masterdata.manage (viewer → 403)', async () => {
      expect(
        (
          await request(app)
            .post('/api/v2/rate-type-assignments/bulk-deactivate')
            .set(TL)
            .send({ ids: [1] })
        ).status,
      ).toBe(403);
    });
  });

  it('a non-existent rateTypeId → 400 INVALID_ASSIGNMENT_REF', async () => {
    const res = await request(app)
      .post('/api/v2/rate-type-assignments')
      .set(SA)
      .send({ clientId, productId, verificationUnitId: unitId, rateTypeId: 999999 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_ASSIGNMENT_REF');
  });

  it('validates input: bad clientId → 400', async () => {
    const res = await request(app)
      .post('/api/v2/rate-type-assignments')
      .set(SA)
      .send({ clientId: 'nope', productId: null, verificationUnitId: null, rateTypeId: rtA });
    expect(res.status).toBe(400);
  });

  describe('RBAC', () => {
    it('list/get require page.masterdata; create/deactivate require masterdata.manage', async () => {
      // FIELD_AGENT holds neither masterdata perm → list 403, create 403
      expect((await request(app).get('/api/v2/rate-type-assignments').set(FA)).status).toBe(403);
      const denied = await request(app)
        .post('/api/v2/rate-type-assignments')
        .set(FA)
        .send({ clientId, productId: null, verificationUnitId: null, rateTypeId: rtA });
      expect(denied.status).toBe(403);
      // TEAM_LEADER holds page.masterdata (can list) + data.export (can export) but NOT manage → create 403
      expect((await request(app).get('/api/v2/rate-type-assignments').set(TL)).status).toBe(200);
      const tlDenied = await request(app)
        .post('/api/v2/rate-type-assignments')
        .set(TL)
        .send({ clientId, productId: null, verificationUnitId: null, rateTypeId: rtA });
      expect(tlDenied.status).toBe(403);
    });
  });

  describe('import / export', () => {
    const HEADER = ['Client Code', 'Product Code', 'Unit Code', 'Rate Type Code'];
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
        .post(`/api/v2/rate-type-assignments/import?mode=${mode}`)
        .set(auth)
        .set('content-type', 'application/octet-stream')
        .set('x-filename', 'rate-type-assignments.xlsx')
        .send(buf);

    it('export is gated data.export (TEAM_LEADER ok, FIELD_AGENT 403)', async () => {
      await request(app)
        .post('/api/v2/rate-type-assignments')
        .set(SA)
        .send({ clientId, productId, verificationUnitId: unitId, rateTypeId: rtA });
      expect(
        (await request(app).get('/api/v2/rate-type-assignments/export?format=csv&mode=all').set(TL)).status,
      ).toBe(200);
      expect(
        (await request(app).get('/api/v2/rate-type-assignments/export?format=csv&mode=all').set(FA)).status,
      ).toBe(403);
    });

    it('export renders Universal for a NULL product/unit row', async () => {
      await request(app)
        .post('/api/v2/rate-type-assignments')
        .set(SA)
        .send({ clientId, productId: null, verificationUnitId: null, rateTypeId: rtA });
      const res = await request(app).get('/api/v2/rate-type-assignments/export?format=csv&mode=all').set(SA);
      expect(res.status).toBe(200);
      const [header, firstRow] = res.text.split('\r\n');
      expect(header).toBe('Client,Product,Unit,Rate Type,Status,Created,Updated');
      expect(firstRow).toContain('Universal');
    });

    it('downloads an XLSX template (200 + PK body); template gated masterdata.manage', async () => {
      const res = await request(app)
        .get('/api/v2/rate-type-assignments/import-template')
        .set(SA)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect((res.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
      expect((await request(app).get('/api/v2/rate-type-assignments/import-template').set(FA)).status).toBe(
        403,
      );
    });

    it('preview resolves a known client (valid) and flags an unknown one (errorRows)', async () => {
      const res = await upload(
        'preview',
        await mkXlsx([
          [clientCode, productCode, unitCode, rtCodeA],
          ['NOPE_CLIENT', '', '', rtCodeA],
        ]),
      );
      expect(res.status).toBe(200);
      expect(res.body.validRows).toBe(1);
      expect(res.body.errorRows).toBe(1);
      expect(res.body.errors[0]).toMatchObject({ column: 'Client Code' });
      // preview is read-only — nothing written
      expect((await request(app).get('/api/v2/rate-type-assignments').set(SA)).body.totalCount).toBe(0);
    });

    it('confirm imports a Universal row (blank product/unit) and grows the list', async () => {
      const res = await upload('confirm', await mkXlsx([[clientCode, '', '', rtCodeA]]));
      expect(res.status).toBe(200);
      expect(res.body.successRows).toBe(1);
      const list = await request(app).get('/api/v2/rate-type-assignments').set(SA);
      expect(list.body.totalCount).toBe(1);
      const row = list.body.items[0] as RateTypeAssignmentView;
      expect(row.productId).toBeNull(); // blank product cell → Universal
      expect(row.verificationUnitId).toBeNull();
      expect(row.rateTypeId).toBe(rtA);
    });
  });
});
