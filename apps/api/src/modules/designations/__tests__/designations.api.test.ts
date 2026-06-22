import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestDb, authHeaderForRole } from '@crm2/test-utils';
import { createApp } from '../../../http/app.js';
import { setPool } from '../../../platform/db.js';

const RUN = !!process.env['DATABASE_URL'];
const db = RUN ? createTestDb() : null;
const app = createApp({ enableTestAuth: true });
const SA = authHeaderForRole('SUPER_ADMIN');
const BE = authHeaderForRole('BACKEND_USER');
const MGR = authHeaderForRole('MANAGER');
const FA = authHeaderForRole('FIELD_AGENT');

const desig = (over: Record<string, unknown> = {}) => ({ name: 'Senior Field Executive', ...over });
const mkDept = async (name = 'Operations'): Promise<number> =>
  (await request(app).post('/api/v2/departments').set(SA).send({ name })).body.id;

describe.skipIf(!RUN)('designations API', () => {
  beforeAll(async () => {
    await db!.migrate();
    setPool(db!.pool);
  });
  afterAll(async () => {
    await db!.end();
  });
  beforeEach(async () => {
    await db!.truncate('designations', 'departments', 'audit_log', 'import_log');
  });

  it('creates a designation linked to a department (201) — departmentName joined', async () => {
    const deptId = await mkDept();
    const created = await request(app)
      .post('/api/v2/designations')
      .set(SA)
      .send(desig({ departmentId: deptId }));
    expect(created.status).toBe(201);
    expect(created.body.departmentId).toBe(deptId);
    expect(created.body.departmentName).toBe('OPERATIONS');
    expect(created.body.version).toBe(1);
  });

  it('creates an unlinked designation (department null)', async () => {
    const created = await request(app).post('/api/v2/designations').set(SA).send(desig());
    expect(created.status).toBe(201);
    expect(created.body.departmentId).toBeNull();
    expect(created.body.departmentName).toBeNull();
  });

  it('a non-existent departmentId → 400 INVALID_REFERENCE', async () => {
    const res = await request(app)
      .post('/api/v2/designations')
      .set(SA)
      .send(desig({ departmentId: 999999 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVALID_REFERENCE');
  });

  it('duplicate name → 409 DESIGNATION_EXISTS', async () => {
    await request(app).post('/api/v2/designations').set(SA).send(desig());
    const dup = await request(app).post('/api/v2/designations').set(SA).send(desig());
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('DESIGNATION_EXISTS');
  });

  it('rejects an empty name with 400 VALIDATION', async () => {
    const res = await request(app)
      .post('/api/v2/designations')
      .set(SA)
      .send(desig({ name: '' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('VALIDATION');
  });

  it('update re-links the department and bumps version', async () => {
    const created = (await request(app).post('/api/v2/designations').set(SA).send(desig())).body;
    const deptId = await mkDept('HR');
    const upd = await request(app)
      .put(`/api/v2/designations/${created.id}`)
      .set(SA)
      .send({ name: created.name, description: '', departmentId: deptId, version: created.version });
    expect(upd.status).toBe(200);
    expect(upd.body.departmentName).toBe('HR');
    expect(upd.body.version).toBe(2);
  });

  it('update without a version → 400 VERSION_REQUIRED; non-existent → 404', async () => {
    const c = (await request(app).post('/api/v2/designations').set(SA).send(desig())).body;
    const noVer = await request(app)
      .put(`/api/v2/designations/${c.id}`)
      .set(SA)
      .send({ name: 'X', description: '' });
    expect(noVer.status).toBe(400);
    expect(noVer.body.error).toBe('VERSION_REQUIRED');
    const missing = await request(app)
      .put('/api/v2/designations/999999')
      .set(SA)
      .send({ name: 'X', description: '', version: 1 });
    expect(missing.status).toBe(404);
    expect(missing.body.error).toBe('DESIGNATION_NOT_FOUND');
  });

  it('options returns only USABLE designations', async () => {
    const a = (
      await request(app)
        .post('/api/v2/designations')
        .set(SA)
        .send(desig({ name: 'A' }))
    ).body;
    await request(app)
      .post('/api/v2/designations')
      .set(SA)
      .send(desig({ name: 'B' }));
    await request(app).post(`/api/v2/designations/${a.id}/deactivate`).set(SA).send({ version: a.version });
    const res = await request(app).get('/api/v2/designations/options').set(SA);
    expect(res.body.map((o: { name: string }) => o.name)).toEqual(['B']);
  });

  it('a role without page.users cannot read/write (403); unauth 401', async () => {
    expect((await request(app).get('/api/v2/designations').set(MGR)).status).toBe(403);
    expect((await request(app).post('/api/v2/designations').set(MGR).send(desig())).status).toBe(403);
    expect((await request(app).get('/api/v2/designations')).status).toBe(401);
  });

  describe('export', () => {
    it('exports current view as CSV with the Department column', async () => {
      const deptId = await mkDept();
      await request(app)
        .post('/api/v2/designations')
        .set(SA)
        .send(desig({ departmentId: deptId }));
      const res = await request(app).get('/api/v2/designations/export?format=csv&mode=current').set(SA);
      expect(res.status).toBe(200);
      expect(res.text.split('\r\n')[0]).toBe(
        'Name,Description,Department,Effective From,Created,Updated,Status',
      );
      expect(res.text).toContain('SENIOR FIELD EXECUTIVE');
      expect(res.text).toContain('OPERATIONS');
    });

    it('BACKEND_USER can export (200); FIELD_AGENT cannot (403)', async () => {
      expect((await request(app).get('/api/v2/designations/export?format=csv').set(BE)).status).toBe(200);
      expect((await request(app).get('/api/v2/designations/export').set(FA)).status).toBe(403);
    });
  });

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
        .post(`/api/v2/designations/import?mode=${mode}`)
        .set(auth)
        .set('content-type', 'application/octet-stream')
        .set('x-filename', 'designations.xlsx')
        .send(buf);

    it('preview flags an invalid row; confirm imports the valid ones (FK-free)', async () => {
      const preview = await upload(
        'preview',
        await mkXlsx([
          ['Exec', 'd', ''],
          ['', 'bad', ''],
        ]),
      );
      expect(preview.body.validRows).toBe(1);
      expect(preview.body.errorRows).toBe(1);
      const confirm = await upload(
        'confirm',
        await mkXlsx([
          ['Exec', 'd', ''],
          ['Lead', 'd2', ''],
        ]),
      );
      expect(confirm.body).toMatchObject({ totalRows: 2, successRows: 2, failedRows: 0 });
      expect((await request(app).get('/api/v2/designations').set(SA)).body.totalCount).toBe(2);
    });
  });
});
