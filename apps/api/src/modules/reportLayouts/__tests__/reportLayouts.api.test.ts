import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, clientFactory, productFactory, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BE = authHeaderForRole('BACKEND_USER'); // NO report_template.manage

function seeded<T>(res: request.Response): T {
  if (res.status >= 400) throw new Error(`seed failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as T;
}

async function seedCp(tag: string): Promise<{ clientId: number; productId: number }> {
  const clientId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/clients')
      .set(SA)
      .send(clientFactory({ code: `C_${tag}` })),
  ).id;
  const productId = seeded<{ id: number }>(
    await request(app)
      .post('/api/v2/products')
      .set(SA)
      .send(productFactory({ code: `P_${tag}` })),
  ).id;
  return { clientId, productId };
}

const column = (over: Record<string, unknown> = {}) => ({
  columnKey: 'case_no',
  headerLabel: 'Case No',
  sourceType: 'CASE_FIELD',
  sourceRef: 'case_number',
  dataType: 'TEXT',
  ...over,
});
const layoutBody = (clientId: number, productId: number, over: Record<string, unknown> = {}) => ({
  clientId,
  productId,
  kind: 'MIS',
  name: 'Axis MIS',
  columns: [column()],
  ...over,
});

describe.skipIf(!RUN)('report-layouts API (ADR-0037 slice 1)', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate('report_layout_columns', 'report_layouts', 'clients', 'products');
  });

  it('creates a layout with ordered columns and reads it back (detail + by-config)', async () => {
    const cp = await seedCp('CR');
    const created = await request(app)
      .post('/api/v2/report-layouts')
      .set(SA)
      .send(
        layoutBody(cp.clientId, cp.productId, {
          columns: [
            column({
              columnKey: 'visit',
              headerLabel: 'Visit',
              sourceType: 'TASK_FIELD',
              sourceRef: 'visit_type',
              displayOrder: 2,
            }),
            column({
              columnKey: 'bill',
              headerLabel: 'Bill',
              sourceType: 'RATE_AMOUNT',
              sourceRef: undefined,
              dataType: 'NUMBER',
              displayOrder: 1,
            }),
          ],
        }),
      );
    expect(created.status).toBe(201);
    expect(created.body.columnCount).toBe(2);
    expect(created.body.columns.map((c: { columnKey: string }) => c.columnKey)).toEqual(['bill', 'visit']); // by display_order
    expect(created.body.version).toBe(1);

    const id = created.body.id as number;
    const detail = await request(app).get(`/api/v2/report-layouts/${id}`).set(SA);
    expect(detail.status).toBe(200);
    expect(detail.body.clientName).toBeTruthy();

    const byConfig = await request(app)
      .get(`/api/v2/report-layouts/by-config?clientId=${cp.clientId}&productId=${cp.productId}&kind=MIS`)
      .set(SA);
    expect(byConfig.status).toBe(200);
    expect(byConfig.body.id).toBe(id);
    // a CPV+kind with no layout → null (a normal answer, not 404)
    const none = await request(app)
      .get(
        `/api/v2/report-layouts/by-config?clientId=${cp.clientId}&productId=${cp.productId}&kind=BILLING_MIS`,
      )
      .set(SA);
    expect(none.status).toBe(200);
    expect(none.body).toBeNull();
  });

  it('FIELD_REPORT: by-config resolves by verificationType; one active per (cpv, type) (ADR-0039 S2b)', async () => {
    const cp = await seedCp('FR');
    const mk = (verificationType: string, name: string) =>
      request(app)
        .post('/api/v2/report-layouts')
        .set(SA)
        .send({
          clientId: cp.clientId,
          productId: cp.productId,
          kind: 'FIELD_REPORT',
          name,
          verificationType,
          templateBody: `Report for {{cust}} (${verificationType}).`,
          columns: [
            column({
              columnKey: 'cust',
              headerLabel: 'Customer',
              sourceType: 'FORM_DATA_PATH',
              sourceRef: 'residence.formData.customerName',
            }),
          ],
        });
    expect((await mk('RESIDENCE', 'Res Report')).status).toBe(201);
    expect((await mk('OFFICE', 'Off Report')).status).toBe(201);
    // a 2nd active RESIDENCE for the same CPV → 409 (one active per cpv+type)
    expect((await mk('RESIDENCE', 'Res Report 2')).status).toBe(409);

    // by-config WITHOUT verificationType matches the type-less kinds only → null for FIELD_REPORT
    const noType = await request(app)
      .get(
        `/api/v2/report-layouts/by-config?clientId=${cp.clientId}&productId=${cp.productId}&kind=FIELD_REPORT`,
      )
      .set(SA);
    expect(noType.status).toBe(200);
    expect(noType.body).toBeNull();
    // by-config WITH verificationType resolves the right template
    const res = await request(app)
      .get(
        `/api/v2/report-layouts/by-config?clientId=${cp.clientId}&productId=${cp.productId}&kind=FIELD_REPORT&verificationType=OFFICE`,
      )
      .set(SA);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('OFF REPORT');
    expect(res.body.verificationType).toBe('OFFICE');
    expect(res.body.templateBody).toContain('OFFICE');
  });

  it('CASE_REPORT: creates with HTML body + page geometry; reads back; rejects {{{ }}} (ADR-0041 S5 slice 3)', async () => {
    const cp = await seedCp('CR');
    const mk = (body: string, name = 'Client Report') =>
      request(app).post('/api/v2/report-layouts').set(SA).send({
        clientId: cp.clientId,
        productId: cp.productId,
        kind: 'CASE_REPORT',
        name,
        templateBody: body,
        pageSize: 'A4',
        pageOrientation: 'portrait',
        columns: [],
      });

    const created = await mk('<h1>{{client.name}}</h1><p>{{case.caseNumber}}</p>');
    expect(created.status).toBe(201);
    expect(created.body.kind).toBe('CASE_REPORT');
    expect(created.body.pageSize).toBe('A4');
    expect(created.body.pageOrientation).toBe('portrait');
    expect(created.body.verificationType).toBeNull();
    expect(created.body.columns).toEqual([]);

    // read back via by-config (CASE_REPORT is type-less → resolves without a verificationType)
    const byConfig = await request(app)
      .get(
        `/api/v2/report-layouts/by-config?clientId=${cp.clientId}&productId=${cp.productId}&kind=CASE_REPORT`,
      )
      .set(SA);
    expect(byConfig.status).toBe(200);
    expect(byConfig.body.templateBody).toContain('{{client.name}}');
    expect(byConfig.body.pageSize).toBe('A4');

    // ⭐ output-encoding gate: ALL raw-output forms rejected (400) on create AND update
    expect((await mk('<p>{{{case.customerName}}}</p>', 'Evil1')).status).toBe(400);
    expect((await mk('<p>{{& case.customerName}}</p>', 'Evil2')).status).toBe(400); // {{& is raw too
    expect((await mk('<p>{{~& case.customerName}}</p>', 'Evil3')).status).toBe(400); // {{~& slips a naive gate
    const updTriple = await request(app)
      .put(`/api/v2/report-layouts/${created.body.id}`)
      .set(SA)
      .send({ templateBody: '<b>{{{x}}}</b>', version: created.body.version });
    expect(updTriple.status).toBe(400);
    const updAmp = await request(app)
      .put(`/api/v2/report-layouts/${created.body.id}`)
      .set(SA)
      .send({ templateBody: '<b>{{& x}}</b>', version: created.body.version });
    expect(updAmp.status).toBe(400);

    // page-geometry update works (OCC)
    const ok = await request(app)
      .put(`/api/v2/report-layouts/${created.body.id}`)
      .set(SA)
      .send({ pageOrientation: 'landscape', version: created.body.version });
    expect(ok.status).toBe(200);
    expect(ok.body.pageOrientation).toBe('landscape');
  });

  it('enforces ONE active layout per (client, product, kind) → 409', async () => {
    const cp = await seedCp('UQ');
    expect(
      (await request(app).post('/api/v2/report-layouts').set(SA).send(layoutBody(cp.clientId, cp.productId)))
        .status,
    ).toBe(201);
    const dup = await request(app)
      .post('/api/v2/report-layouts')
      .set(SA)
      .send(layoutBody(cp.clientId, cp.productId, { name: 'dup' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('REPORT_LAYOUT_EXISTS');
    // a DIFFERENT kind for the same CPV is fine
    expect(
      (
        await request(app)
          .post('/api/v2/report-layouts')
          .set(SA)
          .send(layoutBody(cp.clientId, cp.productId, { kind: 'DATA_ENTRY' }))
      ).status,
    ).toBe(201);
  });

  it('deactivate frees the slot; reactivating over a new active → 409 (OCC throughout)', async () => {
    const cp = await seedCp('DA');
    const a = seeded<{ id: number; version: number }>(
      await request(app).post('/api/v2/report-layouts').set(SA).send(layoutBody(cp.clientId, cp.productId)),
    );
    // stale version → 409
    expect(
      (await request(app).post(`/api/v2/report-layouts/${a.id}/deactivate`).set(SA).send({ version: 99 }))
        .status,
    ).toBe(409);
    // correct version → deactivated
    const deact = await request(app)
      .post(`/api/v2/report-layouts/${a.id}/deactivate`)
      .set(SA)
      .send({ version: a.version });
    expect(deact.status).toBe(200);
    expect(deact.body.isActive).toBe(false);
    // slot free → a new active layout for the same CPV+kind is allowed
    const b = seeded<{ id: number }>(
      await request(app)
        .post('/api/v2/report-layouts')
        .set(SA)
        .send(layoutBody(cp.clientId, cp.productId, { name: 'B' })),
    );
    // reactivating A while B is active → unique-active conflict → 409
    const reA = await request(app)
      .post(`/api/v2/report-layouts/${a.id}/activate`)
      .set(SA)
      .send({ version: deact.body.version });
    expect(reA.status).toBe(409);
    expect(b.id).toBeGreaterThan(0);
  });

  it('updates name + replaces columns in place (OCC); stale version → 409', async () => {
    const cp = await seedCp('UP');
    const c = seeded<{ id: number; version: number }>(
      await request(app).post('/api/v2/report-layouts').set(SA).send(layoutBody(cp.clientId, cp.productId)),
    );
    const upd = await request(app)
      .put(`/api/v2/report-layouts/${c.id}`)
      .set(SA)
      .send({
        name: 'Axis MIS v2',
        version: c.version,
        columns: [
          column({
            columnKey: 'tat',
            headerLabel: 'TAT',
            sourceType: 'TAT',
            sourceRef: undefined,
            dataType: 'NUMBER',
          }),
        ],
      });
    expect(upd.status).toBe(200);
    expect(upd.body.name).toBe('AXIS MIS V2');
    expect(upd.body.version).toBe(c.version + 1);
    expect(upd.body.columns).toHaveLength(1);
    expect(upd.body.columns[0].columnKey).toBe('tat');
    // replay with the now-stale version → 409
    const stale = await request(app)
      .put(`/api/v2/report-layouts/${c.id}`)
      .set(SA)
      .send({ name: 'x', version: c.version });
    expect(stale.status).toBe(409);
  });

  it('validates column source bindings (bad fixed ref / stray refless ref → 400)', async () => {
    const cp = await seedCp('VAL');
    const badFixed = await request(app)
      .post('/api/v2/report-layouts')
      .set(SA)
      .send(
        layoutBody(cp.clientId, cp.productId, {
          columns: [column({ sourceType: 'TASK_FIELD', sourceRef: 'not_a_field' })],
        }),
      );
    expect(badFixed.status).toBe(400);
    const strayRef = await request(app)
      .post('/api/v2/report-layouts')
      .set(SA)
      .send(
        layoutBody(cp.clientId, cp.productId, {
          columns: [column({ sourceType: 'TAT', sourceRef: 'x', dataType: 'NUMBER' })],
        }),
      );
    expect(strayRef.status).toBe(400);
  });

  it('gates writes on report_template.manage (SUPER_ADMIN); BACKEND_USER → 403; bad id → 400', async () => {
    const cp = await seedCp('RBAC');
    expect((await request(app).get('/api/v2/report-layouts').set(BE)).status).toBe(403);
    expect(
      (await request(app).post('/api/v2/report-layouts').set(BE).send(layoutBody(cp.clientId, cp.productId)))
        .status,
    ).toBe(403);
    expect((await request(app).get('/api/v2/report-layouts/not-an-int').set(SA)).status).toBe(400);
  });

  // ── DataGrid export (IMPORT_EXPORT_STANDARD, IE-DEFER-8) ──
  describe('export', () => {
    it('exports the current view as CSV (200 + headers + rows)', async () => {
      const cp = await seedCp('EXC');
      const created = await request(app)
        .post('/api/v2/report-layouts')
        .set(SA)
        .send(layoutBody(cp.clientId, cp.productId, { name: 'Export MIS' }));
      expect(created.status).toBe(201);
      const res = await request(app).get('/api/v2/report-layouts/export?format=csv&mode=current').set(SA);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="report-layouts-\d{8}\.csv"/);
      expect(res.text.split('\r\n')[0]).toBe('Client,Product,Kind,Name,Columns,Status,Created,Updated');
      // headerLabel → toUpper; the layout name 'Export MIS' is upper-cased on create
      expect(res.text).toContain('EXPORT MIS');
      expect(res.text).toContain('MIS');
    });

    it('exports all matching as XLSX (200 + PK-zip body)', async () => {
      const cp = await seedCp('EXX');
      await request(app).post('/api/v2/report-layouts').set(SA).send(layoutBody(cp.clientId, cp.productId));
      const res = await request(app)
        .get('/api/v2/report-layouts/export?format=xlsx&mode=all')
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
      const cp = await seedCp('EXCOL');
      await request(app).post('/api/v2/report-layouts').set(SA).send(layoutBody(cp.clientId, cp.productId));
      const res = await request(app)
        .get('/api/v2/report-layouts/export?format=csv&mode=all&cols=name,kind,status')
        .set(SA);
      expect(res.text.split('\r\n')[0]).toBe('Name,Kind,Status');
    });

    it('rejects an unknown format with 400 BAD_EXPORT_FORMAT', async () => {
      const res = await request(app).get('/api/v2/report-layouts/export?format=pdf').set(SA);
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('BAD_EXPORT_FORMAT');
    });

    it('a role without report_template.manage cannot export (403) — export shares the list audience', async () => {
      // BACKEND_USER is 403 on `GET /` (no report_template.manage); the export must not widen access
      // beyond who can read the layout list.
      expect((await request(app).get('/api/v2/report-layouts/export?format=csv').set(BE)).status).toBe(403);
    });

    it('unauthenticated export is 401', async () => {
      expect((await request(app).get('/api/v2/report-layouts/export')).status).toBe(401);
    });
  });
});
