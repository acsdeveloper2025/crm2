import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BE = authHeaderForRole('BACKEND_USER'); // has data.export, NOT page.users / user.manage
const MGR = authHeaderForRole('MANAGER'); // has neither page.users nor user.manage
const FA = authHeaderForRole('FIELD_AGENT'); // no data.export

const dept = (over: Record<string, unknown> = {}) => ({
  name: 'Operations',
  description: 'Field ops',
  ...over,
});

describe.skipIf(!RUN)('departments API', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate('departments', 'audit_log', 'import_log');
  });

  it('creates a department (201) and lists it', async () => {
    const created = await request(app).post('/api/v2/departments').set(SA).send(dept());
    expect(created.status).toBe(201);
    expect(created.body.name).toBe('OPERATIONS');
    expect(created.body.isActive).toBe(true);
    expect(created.body.version).toBe(1);

    const list = await request(app).get('/api/v2/departments').set(SA);
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.totalCount).toBe(1);
  });

  it('duplicate name → 409 DEPARTMENT_EXISTS', async () => {
    await request(app).post('/api/v2/departments').set(SA).send(dept());
    const dup = await request(app)
      .post('/api/v2/departments')
      .set(SA)
      .send(dept({ description: 'other' }));
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('DEPARTMENT_EXISTS');
  });

  it('rejects an empty name with 400 VALIDATION', async () => {
    const res = await request(app)
      .post('/api/v2/departments')
      .set(SA)
      .send(dept({ name: '' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION');
  });

  it('update changes name/description (OCC version bumps by 1)', async () => {
    const created = (await request(app).post('/api/v2/departments').set(SA).send(dept())).body;
    const upd = await request(app)
      .put(`/api/v2/departments/${created.id}`)
      .set(SA)
      .send({ name: 'Operations', description: 'changed', version: created.version });
    expect(upd.status).toBe(200);
    expect(upd.body.description).toBe('CHANGED');
    expect(upd.body.version).toBe(2);
  });

  it('update without a version → 400 VERSION_REQUIRED', async () => {
    const c = (await request(app).post('/api/v2/departments').set(SA).send(dept())).body;
    const res = await request(app)
      .put(`/api/v2/departments/${c.id}`)
      .set(SA)
      .send({ name: 'X', description: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VERSION_REQUIRED');
  });

  it('update a non-existent id → 404 DEPARTMENT_NOT_FOUND', async () => {
    const res = await request(app)
      .put('/api/v2/departments/999999')
      .set(SA)
      .send({ name: 'X', description: '', version: 1 });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('DEPARTMENT_NOT_FOUND');
  });

  it('concurrent edit at a stale version → 409 STALE_UPDATE with current', async () => {
    const c = (await request(app).post('/api/v2/departments').set(SA).send(dept())).body;
    await request(app)
      .put(`/api/v2/departments/${c.id}`)
      .set(SA)
      .send({ name: 'Operations', description: 'A', version: 1 });
    const b = await request(app)
      .put(`/api/v2/departments/${c.id}`)
      .set(SA)
      .send({ name: 'Operations', description: 'B', version: 1 });
    expect(b.status).toBe(409);
    expect(b.body.error).toBe('STALE_UPDATE');
    expect(b.body.current.version).toBe(2);
  });

  it('activate / deactivate toggles is_active (version-guarded)', async () => {
    const c = (await request(app).post('/api/v2/departments').set(SA).send(dept())).body;
    const off = await request(app)
      .post(`/api/v2/departments/${c.id}/deactivate`)
      .set(SA)
      .send({ version: c.version });
    expect(off.body.isActive).toBe(false);
    expect(off.body.version).toBe(2);
  });

  it('options returns only USABLE departments (active + in effect)', async () => {
    const a = (
      await request(app)
        .post('/api/v2/departments')
        .set(SA)
        .send(dept({ name: 'Ops' }))
    ).body;
    await request(app)
      .post('/api/v2/departments')
      .set(SA)
      .send(dept({ name: 'HR' }));
    await request(app).post(`/api/v2/departments/${a.id}/deactivate`).set(SA).send({ version: a.version });
    const res = await request(app).get('/api/v2/departments/options').set(SA);
    expect(res.status).toBe(200);
    expect(res.body.map((o: { name: string }) => o.name)).toEqual(['HR']); // Ops is inactive
  });

  it('every create/update appends an immutable audit_log row', async () => {
    const c = (await request(app).post('/api/v2/departments').set(SA).send(dept())).body;
    const { rows } = await db!.pool.query(
      `SELECT action FROM audit_log WHERE entity_type = 'departments' AND entity_id = $1`,
      [String(c.id)],
    );
    expect(rows.map((r) => r.action)).toEqual(['CREATE']);
  });

  // ── RBAC: reads gated by page.users (SUPER_ADMIN only, like the users module) ──
  it('a role without page.users cannot read or write (403); unauth is 401', async () => {
    expect((await request(app).get('/api/v2/departments').set(MGR)).status).toBe(403);
    expect((await request(app).get('/api/v2/departments').set(BE)).status).toBe(403);
    expect((await request(app).post('/api/v2/departments').set(MGR).send(dept())).status).toBe(403);
    expect((await request(app).get('/api/v2/departments')).status).toBe(401);
  });

  // ── export (DATA_EXPORT) ──
  describe('export', () => {
    it('exports the current view as CSV', async () => {
      await request(app).post('/api/v2/departments').set(SA).send(dept());
      const res = await request(app).get('/api/v2/departments/export?format=csv&mode=current').set(SA);
      expect(res.status).toBe(200);
      expect(res.text.split('\r\n')[0]).toBe('Name,Description,Effective From,Created,Updated,Status');
      expect(res.text).toContain('OPERATIONS,FIELD OPS');
    });

    it('a data.export-only role without page.users cannot export (403) — export shares the list audience; unauth 401', async () => {
      // BACKEND_USER holds data.export but is 403 on the department list (page.users); the export must
      // not widen access beyond who can read the list (org structure is not export-widened).
      expect((await request(app).get('/api/v2/departments/export?format=csv').set(BE)).status).toBe(403);
      expect((await request(app).get('/api/v2/departments/export').set(FA)).status).toBe(403);
      expect((await request(app).get('/api/v2/departments/export')).status).toBe(401);
    });
  });

  // ── bulk (per-row OCC) ──
  it('bulk-deactivate applies per-row and reports OK', async () => {
    const a = (
      await request(app)
        .post('/api/v2/departments')
        .set(SA)
        .send(dept({ name: 'A' }))
    ).body;
    const b = (
      await request(app)
        .post('/api/v2/departments')
        .set(SA)
        .send(dept({ name: 'B' }))
    ).body;
    const res = await request(app)
      .post('/api/v2/departments/bulk-deactivate')
      .set(SA)
      .send({
        items: [
          { id: a.id, version: a.version },
          { id: b.id, version: b.version },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ okCount: 2, conflictCount: 0, notFoundCount: 0 });
  });

  // ── import (B-14) ──
  describe('import', () => {
    const HEADER = ['Name', 'Description', 'Effective From'];
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
        .post(`/api/v2/departments/import?mode=${mode}`)
        .set(auth)
        .set('content-type', 'application/octet-stream')
        .set('x-filename', 'departments.xlsx')
        .send(buf);

    it('downloads a template (200 + PK body)', async () => {
      const res = await request(app)
        .get('/api/v2/departments/import-template')
        .set(SA)
        .buffer(true)
        .parse((r, cb) => {
          const chunks: Buffer[] = [];
          r.on('data', (c: Buffer) => chunks.push(c));
          r.on('end', () => cb(null, Buffer.concat(chunks)));
        });
      expect(res.status).toBe(200);
      expect((res.body as Buffer).subarray(0, 2).toString('latin1')).toBe('PK');
    });

    it('preview flags an invalid row, confirm imports the valid ones + writes import_log', async () => {
      const preview = await upload(
        'preview',
        await mkXlsx([
          ['Ops', 'desc', ''],
          ['', 'bad', ''],
        ]),
      );
      expect(preview.body.validRows).toBe(1);
      expect(preview.body.errorRows).toBe(1);
      const confirm = await upload(
        'confirm',
        await mkXlsx([
          ['Ops', 'd', ''],
          ['HR', 'd2', ''],
        ]),
      );
      expect(confirm.body).toMatchObject({ totalRows: 2, successRows: 2, failedRows: 0 });
      expect((await request(app).get('/api/v2/departments').set(SA)).body.totalCount).toBe(2);
    });

    it('a role without user.manage cannot import (403)', async () => {
      expect((await upload('preview', await mkXlsx([['Ops', '', '']]), MGR)).status).toBe(403);
    });
  });
});
